from app.services.attendance import get_local_now
from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from typing import List, Optional
from datetime import datetime, timedelta
import hashlib
import hmac
import re
import secrets
import string
from app.models.employee import Employee, RoleEnum, EmployeeStatusEnum
from app.models.department import SystemConfig
from app.schemas.employee import AdminAccountCreate, EmployeeCreate, EmployeeUpdate, EmployeeAdminUpdate
from app.core.config import settings
from app.core.security import create_access_token, decode_access_token, hash_password
from app.services.email_identity import ensure_email_available, normalize_email
from app.services.notifications import send_account_activation_email, send_admin_account_otp_email
from app.services.attendance import get_local_today
from app.services.week_off_history import apply_week_off_change

RESERVED_PRIVILEGED_ID_MIN = 10001
RESERVED_PRIVILEGED_ID_MAX = 10010
GENERAL_EMPLOYEE_ID_START = 10011
ADMIN_ACCOUNT_OTP_PURPOSE = "admin_account_email_otp"
ADMIN_ACCOUNT_VERIFIED_PURPOSE = "admin_account_email_verified"
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
DIRECTORY_EMPLOYEE_ROLES = [RoleEnum.EMPLOYEE, RoleEnum.HOD]


def send_email_verification_email(**kwargs) -> bool:
    """Compatibility wrapper for older email-verification call sites."""
    return send_account_activation_email(**kwargs)


def get_next_employee_id(db: Session) -> int:
    """Retrieve the next valid Employee ID by finding the max and incrementing."""
    system_config = db.query(SystemConfig).filter(SystemConfig.key == "EMPLOYEE_ID_START").first()
    start_id = int(system_config.value) if system_config else GENERAL_EMPLOYEE_ID_START
    start_id = max(start_id, GENERAL_EMPLOYEE_ID_START)

    max_employee = (
        db.query(Employee)
        .filter(Employee.employee_id >= start_id)
        .order_by(Employee.employee_id.desc())
        .first()
    )

    if max_employee and max_employee.employee_id >= start_id:
        return max_employee.employee_id + 1
    return start_id


def generate_temporary_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits
    while True:
        password = "".join(secrets.choice(alphabet) for _ in range(length))
        if any(c.islower() for c in password) and any(c.isupper() for c in password) and any(c.isdigit() for c in password):
            return password


def _otp_digest(email: str, otp: str, salt: str) -> str:
    value = f"{normalize_email(email)}:{otp}:{salt}:{settings.SECRET_KEY}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _require_valid_email(email: str) -> str:
    normalized_email = normalize_email(email)
    if not normalized_email or not EMAIL_PATTERN.match(normalized_email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please enter a valid email address.")
    return normalized_email


def request_admin_account_email_otp(
    db: Session,
    email: str,
    requested_by: Employee,
) -> tuple[str, str, bool]:
    if requested_by.role != RoleEnum.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only SuperAdmin can verify Admin and HR account emails.",
        )

    normalized_email = ensure_email_available(db, _require_valid_email(email))
    otp = f"{secrets.randbelow(1_000_000):06d}"
    salt = secrets.token_hex(16)
    otp_token = create_access_token(
        data={
            "sub": normalized_email,
            "purpose": ADMIN_ACCOUNT_OTP_PURPOSE,
            "salt": salt,
            "otp_digest": _otp_digest(normalized_email, otp, salt),
        },
        expires_delta=timedelta(minutes=10),
    )
    sent = send_admin_account_otp_email(
        db=db,
        email_to=normalized_email,
        otp=otp,
        requested_by_name=f"{requested_by.first_name} {requested_by.last_name}",
    )
    return normalized_email, otp_token, sent


def verify_admin_account_email_otp(email: str, otp: str, otp_token: str) -> tuple[str, str]:
    normalized_email = _require_valid_email(email)
    payload = decode_access_token(otp_token)
    if not payload or payload.get("purpose") != ADMIN_ACCOUNT_OTP_PURPOSE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OTP is invalid or has expired.")

    token_email = normalize_email(payload.get("sub"))
    salt = payload.get("salt")
    expected_digest = payload.get("otp_digest")
    if not token_email or token_email != normalized_email or not salt or not expected_digest:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OTP is invalid or has expired.")

    actual_digest = _otp_digest(normalized_email, otp, salt)
    if not hmac.compare_digest(actual_digest, expected_digest):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OTP.")

    verification_token = create_access_token(
        data={"sub": normalized_email, "purpose": ADMIN_ACCOUNT_VERIFIED_PURPOSE},
        expires_delta=timedelta(minutes=20),
    )
    return normalized_email, verification_token


def _validate_admin_account_email_verification_token(email: str, verification_token: str | None) -> str:
    normalized_email = _require_valid_email(email)
    if not verification_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please verify the account email before creating the account.",
        )
    payload = decode_access_token(verification_token)
    if not payload or payload.get("purpose") != ADMIN_ACCOUNT_VERIFIED_PURPOSE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please verify the account email before creating the account.",
        )
    token_email = normalize_email(payload.get("sub"))
    if token_email != normalized_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verified email does not match the account email.",
        )
    return normalized_email


def get_next_privileged_account_id(db: Session) -> int:
    used_ids = {
        row[0]
        for row in db.query(Employee.employee_id)
        .filter(Employee.employee_id.between(RESERVED_PRIVILEGED_ID_MIN, RESERVED_PRIVILEGED_ID_MAX))
        .all()
    }
    for account_id in range(RESERVED_PRIVILEGED_ID_MIN, RESERVED_PRIVILEGED_ID_MAX + 1):
        if account_id not in used_ids:
            return account_id
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="No reserved Admin/HR account IDs are available.",
    )


def create_privileged_account(
    db: Session,
    account_in: AdminAccountCreate,
    created_by: Employee,
) -> tuple[Employee, str, bool]:
    """Create Admin/HR accounts in the reserved 10001-10010 range."""
    if created_by.role != RoleEnum.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only SuperAdmin can create Admin and HR accounts.",
        )

    if account_in.role not in [RoleEnum.ADMIN, RoleEnum.HR]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only Admin and HR accounts can be created here.",
        )
    if account_in.phone and not re.fullmatch(r"\d{10}", account_in.phone.strip()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phone number must be 10 digits.",
        )

    normalized_email = _validate_admin_account_email_verification_token(
        account_in.email,
        account_in.email_verification_token,
    )
    ensure_email_available(db, normalized_email)

    account_id = account_in.account_id or get_next_privileged_account_id(db)
    if not RESERVED_PRIVILEGED_ID_MIN <= account_id <= RESERVED_PRIVILEGED_ID_MAX:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Admin and HR account IDs must be between 10001 and 10010.",
        )
    existing_id = db.query(Employee).filter(Employee.employee_id == account_id).first()
    if existing_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Account ID {account_id} is already in use.",
        )

    temporary_password = generate_temporary_password()
    account = Employee(
        employee_id=account_id,
        first_name=account_in.first_name,
        last_name=account_in.last_name,
        email=normalized_email,
        phone=account_in.phone.strip() if account_in.phone else None,
        email_verified=False,
        role=account_in.role,
        hashed_password=hash_password(temporary_password),
        status=EmployeeStatusEnum.INACTIVE,
    )
    db.add(account)
    db.commit()
    db.refresh(account)

    invitation_sent = False
    if account_in.send_invitation:
        invitation_sent = send_account_activation_email(
            db=db,
            employee=account,
            requested_by_name=f"{created_by.first_name} {created_by.last_name}",
        )

    return account, temporary_password, invitation_sent


def create_employee(db: Session, employee_in: EmployeeCreate, created_by: Employee) -> Employee:
    """Create a new Employee in the system. HR and Admin can create."""
    if created_by.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to create Employee"
        )

    normalized_email = ensure_email_available(db, employee_in.email)

    new_employee_id = get_next_employee_id(db)

    employee = Employee(
        employee_id=new_employee_id,
        first_name=employee_in.first_name,
        last_name=employee_in.last_name,
        email=normalized_email,
        email_verified=False,
        role=employee_in.role,
        department_id=employee_in.department_id,
        hashed_password=hash_password(employee_in.password),
        status=EmployeeStatusEnum.ACTIVE
    )
    db.add(employee)
    db.commit()
    db.refresh(employee)
    if employee.email:
        send_email_verification_email(db=db, employee=employee, requested_by_name=f"{created_by.first_name} {created_by.last_name}")
    return employee


def get_employee_by_id(db: Session, id: str) -> Optional[Employee]:
    return db.query(Employee).filter(Employee.id == id).first()


def get_all_employees(
    db: Session,
    current_user: Employee,
    skip: int = 0,
    limit: int = 100,
    department_id: Optional[str] = None
) -> List[Employee]:
    """Retrieve list of Employees based on user role."""
    query = db.query(Employee).filter(
        Employee.is_active == True,
        Employee.role.in_(DIRECTORY_EMPLOYEE_ROLES),
    )

    # Filtering based on role
    if current_user.role == RoleEnum.HOD:
        query = query.filter(Employee.department_id == current_user.department_id)
    elif current_user.role in [RoleEnum.EMPLOYEE]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to list Employees"
        )

    if department_id and current_user.role in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        query = query.filter(Employee.department_id == department_id)

    return query.offset(skip).limit(limit).all()


def get_onboarding_employees(
    db: Session,
    current_user: Employee,
    start_date: datetime = None,
    end_date: datetime = None,
) -> List[Employee]:
    """Get ALL self-onboarded employees (id_proof_path IS NOT NULL), both activated and pending.
    Optionally filter by created_at date range (financial month)."""
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions"
        )
    query = db.query(Employee).filter(
        Employee.id_proof_path.isnot(None),
        Employee.role.in_(DIRECTORY_EMPLOYEE_ROLES),
    )
    if start_date:
        query = query.filter(Employee.created_at >= start_date)
    if end_date:
        query = query.filter(Employee.created_at <= end_date)
    return query.order_by(Employee.created_at.desc()).all()


def update_employee_profile(db: Session, db_employee: Employee, employee_in: EmployeeUpdate) -> Employee:
    """Update general profile data."""
    update_data = employee_in.dict(exclude_unset=True)
    email_changed = False
    previous_email = normalize_email(db_employee.email)
    new_week_off = update_data.pop("default_week_off", None)
    if "email" in update_data:
        update_data["email"] = ensure_email_available(
            db,
            update_data["email"],
            exclude_employee_id=db_employee.id,
        )
    for field, value in update_data.items():
        setattr(db_employee, field, value)
        if field == "email" and value != previous_email:
            email_changed = True
            db_employee.email_verified = False

    if new_week_off is not None and new_week_off != db_employee.default_week_off:
        apply_week_off_change(db, db_employee, new_week_off, get_local_today())
        db_employee.default_week_off = new_week_off

    db_employee.updated_at = get_local_now()
    db.commit()
    db.refresh(db_employee)
    if email_changed and db_employee.email:
        send_email_verification_email(db=db, employee=db_employee, requested_by_name="Profile update")
    return db_employee


def admin_update_employee(db: Session, db_employee: Employee, employee_in: EmployeeAdminUpdate, current_user: Employee) -> Employee:
    """Admin/HR level update (includes role and status changes)."""
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to perform admin update"
        )

    update_data = employee_in.dict(exclude_unset=True)
    email_changed = False
    previous_email = normalize_email(db_employee.email)
    new_week_off = update_data.pop("default_week_off", None)
    if "email" in update_data:
        update_data["email"] = ensure_email_available(
            db,
            update_data["email"],
            exclude_employee_id=db_employee.id,
        )
    for field, value in update_data.items():
        setattr(db_employee, field, value)
        if field == "email" and value != previous_email:
            email_changed = True
            db_employee.email_verified = False

    effective_department_id = update_data.get("department_id", db_employee.department_id)
    effective_role = update_data.get("role", db_employee.role)
    if effective_role == RoleEnum.HOD and not effective_department_id:
        raise HTTPException(status_code=400, detail="HOD must have a department assigned.")
    if not effective_department_id and db_employee.role == RoleEnum.HOD:
        db_employee.role = RoleEnum.EMPLOYEE

    if new_week_off is not None and new_week_off != db_employee.default_week_off:
        apply_week_off_change(db, db_employee, new_week_off, get_local_today())
        db_employee.default_week_off = new_week_off

    # Unlock logic check
    if 'status' in update_data and update_data['status'] == EmployeeStatusEnum.ACTIVE:
        db_employee.failed_login_attempts = 0

    db_employee.updated_at = get_local_now()
    db.commit()
    db.refresh(db_employee)
    if email_changed and db_employee.email:
        send_email_verification_email(db=db, employee=db_employee, requested_by_name=f"{current_user.first_name} {current_user.last_name}")
    return db_employee
