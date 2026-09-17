import logging
from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from app.models.employee import Employee, EmployeeStatusEnum, AccountEvent, RoleEnum
from app.core.security import (
    verify_password,
    create_access_token,
    hash_password,
    decode_access_token
)
from app.services.attendance import get_local_now
from app.services.email_identity import normalize_email
from app.services.notifications import create_password_reset_notification, send_account_activation_email

logger = logging.getLogger(__name__)


def get_max_failed_attempts(db: Session) -> int:
    """Get max failed login attempts from system config."""
    from app.models.department import SystemConfig
    config = db.query(SystemConfig).filter(
        SystemConfig.key == "MAX_FAILED_LOGIN_ATTEMPTS"
    ).first()
    return int(config.value) if config else 3  # default 3


def authenticate_employee(
    db: Session,
    identifier: str | None = None,
    password: str = "",
    ip_address: str = None,
    employee_id: int | None = None,
) -> Employee:
    """Authenticate a Employee by numeric ID or email and password."""

    # Determine if identifier is numeric Employee ID or email
    identifier = str(identifier if identifier is not None else employee_id or "").strip()
    if not identifier:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid ID or password."
        )
    if identifier.isdigit():
        employee = db.query(Employee).filter(Employee.employee_id == int(identifier)).first()
    else:
        from sqlalchemy import func

        employee = db.query(Employee).filter(func.lower(Employee.email) == normalize_email(identifier)).first()

    # Log failed attempt helper
    def log_failed_attempt():
        event = AccountEvent(
            employee_id=employee.id if employee else "unknown",
            event_type="LOGIN_FAILED",
            ip_address=ip_address,
        )
        db.add(event)
        db.commit()

    # Employee not found
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid ID or password."
        )

    # Account locked
    if employee.status == EmployeeStatusEnum.LOCKED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is locked. Please contact Admin."
        )

    # Account deactivated (inactive) — cannot login
    if employee.status == EmployeeStatusEnum.INACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is not yet activated. Please click the activation link sent to your inbox."
        )

    # Wrong password
    if not verify_password(password, employee.hashed_password):
        # Admin and SuperAdmin are never locked out
        if employee.role in [RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
            log_failed_attempt()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid ID or password."
            )

        max_attempts = get_max_failed_attempts(db)
        employee.failed_login_attempts += 1

        # Lock account if max attempts reached
        if employee.failed_login_attempts >= max_attempts:
            employee.status = EmployeeStatusEnum.LOCKED
            db.commit()

            # Log lock event
            lock_event = AccountEvent(
                employee_id=employee.id,
                event_type="LOCKED",
                ip_address=ip_address,
                notes=f"Auto-locked after {max_attempts} failed attempts"
            )
            db.add(lock_event)
            db.commit()

            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"All of the {max_attempts} attempts have been failed. Please contact Admin to unlock your account."
            )

        db.commit()
        log_failed_attempt()

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid ID or password. "
                   f"{max_attempts - employee.failed_login_attempts} attempts remaining."
        )

    if not employee.email_verified and employee.email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Email address is not verified. Please click the activation link sent to your inbox."
        )

    # Successful login — reset failed attempts
    employee.failed_login_attempts = 0
    employee.last_login = get_local_now()
    db.commit()

    return employee


def generate_token(employee: Employee) -> dict:
    """Generate JWT token for authenticated employee."""
    token = create_access_token(data={"sub": employee.id})
    return {
        "access_token": token,
        "token_type": "bearer",
        "role": employee.role,
        "employee_id": employee.employee_id,
        "full_name": f"{employee.first_name} {employee.last_name}"
    }


def change_password(
    db: Session,
    employee: Employee,
    current_password: str,
    new_password: str
) -> bool:
    """Change password after verifying current password."""
    if not verify_password(current_password, employee.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect."
        )
    employee.hashed_password = hash_password(new_password)
    employee.updated_at = get_local_now()
    db.commit()
    return True


def reset_password_with_token(
    db: Session,
    employee_id: str,
    token: str,
    new_password: str
) -> bool:
    """Verify reset token and update password."""
    employee = validate_reset_password_token(db=db, employee_id=employee_id, token=token)

    employee.hashed_password = hash_password(new_password)
    employee.failed_login_attempts = 0
    employee.status = EmployeeStatusEnum.ACTIVE
    employee.updated_at = get_local_now()

    # Log reset event
    event = AccountEvent(
        employee_id=employee.id,
        event_type="PASSWORD_RESET_COMPLETED",
        notes="Password reset using email token"
    )
    db.add(event)
    db.commit()
    return True


def validate_reset_password_token(
    db: Session,
    employee_id: str,
    token: str,
) -> Employee:
    """Validate a password reset token and return the matching Employee."""
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reset link is invalid or has expired."
        )

    if payload.get("purpose") != "reset_password":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reset link is invalid or has expired."
        )

    if str(payload.get("sub")) != str(employee_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reset link is invalid or has expired."
        )

    employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reset link is invalid or has expired."
        )

    # Enforce single active link: token must be the most recently issued one
    token_iat = payload.get("iat")
    if token_iat is not None and employee.password_reset_token_issued_at is not None:
        from datetime import timezone
        # JWT iat is a Unix timestamp; convert stored datetime to timestamp for comparison
        stored_ts = employee.password_reset_token_issued_at.replace(tzinfo=timezone.utc).timestamp()
        if token_iat < stored_ts - 2:  # 2-second tolerance for clock skew
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This reset link has been invalidated because a newer link was generated. Please use the most recent link sent to your email."
            )
    elif employee.password_reset_token_issued_at is not None and token_iat is None:
        # Old token without iat, but tracking is enabled → reject
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This reset link has been invalidated because a newer link was generated. Please use the most recent link sent to your email."
        )

    return employee


def activate_account_with_token(
    db: Session,
    employee_id: str,
    token: str,
) -> dict:
    from app.services.employee import get_next_employee_id

    employee = validate_account_activation_token(db=db, employee_id=employee_id, token=token)

    # If first time activation, activate account and allocate employee_id
    is_first_activation = not employee.email_verified

    employee.email_verified = True
    employee.status = EmployeeStatusEnum.ACTIVE
    employee.updated_at = get_local_now()
    employee.activated_at = get_local_now()

    # Allocate employee_id if not already allocated. Pending onboarding accounts use <= 0 placeholders.
    if employee.employee_id is None or employee.employee_id <= 0:
        employee.employee_id = get_next_employee_id(db)

    event = AccountEvent(
        employee_id=employee.id,
        event_type="ACCOUNT_ACTIVATED",
        notes="Account activated via email link - Employee ID allocated"
    )
    db.add(event)
    db.commit()

    # Generate login token so user is auto-logged in
    access_token = create_access_token(data={"sub": employee.id})

    return {
        "success": True,
        "employee_id": employee.employee_id,
        "access_token": access_token,
        "token_type": "bearer",
        "role": employee.role,
        "full_name": f"{employee.first_name} {employee.last_name}",
        "message": f"Account activated successfully! Your Employee ID is {employee.employee_id}."
    }


def validate_account_activation_token(
    db: Session,
    employee_id: str,
    token: str,
) -> Employee:
    """Validate an account activation token and return the matching Employee."""
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account activation link is invalid or has expired."
        )

    if payload.get("purpose") != "activate_account":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account activation link is invalid or has expired."
        )

    if str(payload.get("sub")) != str(employee_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account activation link is invalid or has expired."
        )

    employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account activation link is invalid or has expired."
        )

    return employee


def verify_email_with_token(db: Session, employee_id: str, token: str) -> bool:
    """Backward-compatible email verification used by existing tests and older links."""
    payload = decode_access_token(token)
    if not payload or payload.get("purpose") != "verify_email" or str(payload.get("sub")) != str(employee_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email verification link is invalid or has expired."
        )

    employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Email verification link is invalid or has expired."
        )

    employee.email_verified = True
    employee.updated_at = get_local_now()
    event = AccountEvent(
        employee_id=employee.id,
        event_type="EMAIL_VERIFIED",
        notes="Email verified using legacy verification token",
    )
    db.add(event)
    db.commit()
    return True


def resend_activation_email(db: Session, employee: Employee, requested_by_name: str | None = None) -> bool:
    if not employee.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Employee does not have an email address configured."
        )
    if employee.email_verified:
        return True
    return send_account_activation_email(db=db, employee=employee, requested_by_name=requested_by_name)
