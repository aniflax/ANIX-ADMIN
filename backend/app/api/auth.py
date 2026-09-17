from fastapi import APIRouter, Request
from app.core.dependencies import DbSession, CurrentEmployee
from app.schemas.auth import (
    LoginRequest,
    TokenResponse,
    PasswordChangeRequest,
    CurrentEmployeeResponse,
    PasswordResetConfirm,
    PasswordResetValidate,
    AccountActivationConfirm,
    AccountActivationValidate,
    EmailVerificationConfirm,
)
from app.services.auth import (
    authenticate_employee, 
    generate_token, 
    change_password,
    validate_reset_password_token,
    reset_password_with_token,
    validate_account_activation_token,
    activate_account_with_token,
    verify_email_with_token,
)
from app.services.week_off_history import serialize_week_off_history

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


@router.post("/login", response_model=TokenResponse)
def login(
    request: Request,
    payload: LoginRequest,
    db: DbSession
):
    """Login with Employee ID or Email and password."""
    ip_address = request.client.host
    employee = authenticate_employee(
        db=db,
        identifier=payload.identifier or (str(payload.employee_id) if payload.employee_id is not None else None),
        password=payload.password,
        ip_address=ip_address
    )
    return generate_token(employee)


@router.get("/me", response_model=CurrentEmployeeResponse)
def get_current_user(current_employee: CurrentEmployee, db: DbSession):
    """Get currently logged in Employee details."""
    return {
        **current_employee.__dict__,
        "full_name": f"{current_employee.first_name} {current_employee.last_name}".strip(),
        "week_off_history": serialize_week_off_history(db, current_employee),
    }


@router.post("/change-password")
def change_pwd(
    payload: PasswordChangeRequest,
    current_employee: CurrentEmployee,
    db: DbSession
):
    """Change password for currently logged in Employee."""
    change_password(
        db=db,
        employee=current_employee,
        current_password=payload.current_password,
        new_password=payload.new_password
    )
    return {"message": "Password changed successfully."}


@router.post("/reset-password-confirm")
def reset_password_confirm(
    payload: PasswordResetConfirm,
    db: DbSession
):
    """Confirm password reset using token from email."""
    reset_password_with_token(
        db=db,
        employee_id=payload.employee_id,
        token=payload.token,
        new_password=payload.new_password
    )
    return {"message": "Password has been reset successfully."}


@router.post("/reset-password-validate")
def validate_reset_password_link(
    payload: PasswordResetValidate,
    db: DbSession
):
    """Validate a password reset link without changing the password."""
    validate_reset_password_token(
        db=db,
        employee_id=payload.employee_id,
        token=payload.token,
    )
    return {"message": "Reset link is valid."}


@router.post("/activate-account")
def activate_account_confirm(
    payload: AccountActivationConfirm,
    db: DbSession
):
    """Confirm account activation using token from email. Activates account and allocates Employee ID."""
    result = activate_account_with_token(
        db=db,
        employee_id=payload.employee_id,
        token=payload.token,
    )
    return result


@router.post("/activate-account-validate")
def validate_account_activation_link(
    payload: AccountActivationValidate,
    db: DbSession
):
    """Validate an account activation link without activating the account."""
    validate_account_activation_token(
        db=db,
        employee_id=payload.employee_id,
        token=payload.token,
    )
    return {"message": "Activation link is valid."}


@router.post("/verify-email")
def verify_email_link(
    payload: EmailVerificationConfirm,
    db: DbSession
):
    """Legacy email verification endpoint kept for older links/tests."""
    verify_email_with_token(db=db, employee_id=payload.employee_id, token=payload.token)
    return {"message": "Email address verified successfully."}
