from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from app.models.employee import RoleEnum


class LoginRequest(BaseModel):
    identifier: Optional[str] = None  # Employee ID (numeric) or Email address
    employee_id: Optional[int] = None
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: RoleEnum
    employee_id: int
    full_name: str


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str

    class Config:
        json_schema_extra = {
            "example": {
                "current_password": "oldpassword123",
                "new_password": "newpassword456"
            }
        }


class PasswordResetRequest(BaseModel):
    employee_id: int
    new_password: str


class PasswordResetConfirm(BaseModel):
    token: str
    employee_id: str
    new_password: str


class PasswordResetValidate(BaseModel):
    token: str
    employee_id: str


class AccountActivationConfirm(BaseModel):
    token: str
    employee_id: str


class AccountActivationValidate(BaseModel):
    token: str
    employee_id: str


class EmailVerificationConfirm(BaseModel):
    token: str
    employee_id: str


class CurrentEmployeeResponse(BaseModel):
    id: str
    employee_id: int
    first_name: str
    last_name: str
    full_name: str
    email: Optional[str] = None
    email_verified: bool = False
    role: RoleEnum
    department_id: Optional[str]
    default_week_off: str
    week_off_history: list[dict] = []
    activated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
