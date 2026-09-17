from typing import Optional
from pydantic import BaseModel, Field
from datetime import date, datetime
from app.models.employee import RoleEnum, EmployeeStatusEnum

class EmployeeBase(BaseModel):
    first_name: str = Field(..., max_length=100)
    last_name: str = Field(..., max_length=100)
    email: Optional[str] = None
    role: RoleEnum = RoleEnum.EMPLOYEE
    department_id: Optional[str] = None

class EmployeeCreate(EmployeeBase):
    password: str = Field(..., min_length=6)

class EmployeeUpdate(BaseModel):
    first_name: Optional[str] = Field(None, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    email: Optional[str] = None
    department_id: Optional[str] = None
    default_week_off: Optional[str] = "Sunday"
    phone: Optional[str] = None
    address: Optional[str] = None
    # Cannot update role or status directly here except by admin

class EmployeeAdminUpdate(EmployeeUpdate):
    role: Optional[RoleEnum] = None
    status: Optional[EmployeeStatusEnum] = None


class WeekOffHistoryEntry(BaseModel):
    week_off_day: str
    effective_from: date

class AdminAccountCreate(BaseModel):
    account_id: Optional[int] = Field(None, ge=10001, le=10010)
    role: RoleEnum
    first_name: str = Field(..., min_length=2, max_length=100)
    last_name: str = Field(..., min_length=2, max_length=100)
    phone: Optional[str] = Field(None, max_length=20)
    email: str = Field(..., max_length=255)
    email_verification_token: Optional[str] = None
    send_invitation: bool = True


class AdminAccountOtpRequest(BaseModel):
    email: str = Field(..., max_length=255)


class AdminAccountOtpResponse(BaseModel):
    email: str
    otp_token: str
    message: str


class AdminAccountOtpVerifyRequest(BaseModel):
    email: str = Field(..., max_length=255)
    otp: str = Field(..., min_length=6, max_length=6)
    otp_token: str = Field(..., min_length=20)


class AdminAccountOtpVerifyResponse(BaseModel):
    email: str
    email_verification_token: str
    message: str
    
class EmployeeResponse(EmployeeBase):
    id: str
    employee_id: int
    email_verified: bool = False
    status: EmployeeStatusEnum
    failed_login_attempts: int
    phone: Optional[str] = None
    address: Optional[str] = None
    id_proof_path: Optional[str] = None
    pan_card_path: Optional[str] = None
    passbook_path: Optional[str] = None
    default_week_off: str = "Sunday"
    week_off_history: list[WeekOffHistoryEntry] = []
    is_active: bool
    delete_requested: bool = False
    delete_requested_by: Optional[str] = None
    hr_leave_modified: bool = False
    created_at: datetime
    updated_at: datetime
    last_login: Optional[datetime] = None
    activated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
class LockedAccountResponse(BaseModel):
    id: str
    employee_id: int
    first_name: str
    last_name: str
    email: Optional[str] = None
    email_verified: bool = False
    phone: Optional[str] = None
    lock_reason: str
    locked_at: datetime
    reset_pending: bool = False

    class Config:
        from_attributes = True

class DeleteRequestResponse(BaseModel):
    id: str
    employee_id: int
    first_name: str
    last_name: str
    email: Optional[str] = None
    role: RoleEnum
    delete_requested_by: Optional[str] = None
    delete_requested_by_name: Optional[str] = None

    class Config:
        from_attributes = True

class AdminAccountCreateResponse(BaseModel):
    account: EmployeeResponse
    temporary_password: str
    invitation_sent: bool = False
    message: str

class AccountCredentialsEmailRequest(BaseModel):
    temporary_password: str = Field(..., min_length=6)
