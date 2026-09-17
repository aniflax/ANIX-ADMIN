from typing import Optional, List
from pydantic import BaseModel
from datetime import date, datetime
from app.models.leave import LeaveRequestStatus

class LeaveTypeBase(BaseModel):
    name: str
    description: Optional[str] = None
    annual_quota: int
    max_consecutive_days: Optional[int] = None

class LeaveTypeCreate(LeaveTypeBase):
    pass

class LeaveTypeUpdate(LeaveTypeBase):
    name: Optional[str] = None
    annual_quota: Optional[int] = None
    is_active: Optional[bool] = None

class LeaveTypeDeleteRequest(BaseModel):
    password: str

class LeaveTypeResponse(LeaveTypeBase):
    id: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class LeaveBalanceResponse(BaseModel):
    id: str
    employee_id: str
    leave_type_id: str
    year: int
    total_allocated: float
    used: float
    pending: float
    available: float  # Computed field

    class Config:
        from_attributes = True

class LeaveRequestBase(BaseModel):
    leave_type_id: str
    start_date: date
    end_date: date
    reason: str

class LeaveRequestCreate(LeaveRequestBase):
    is_half_day: bool = False
    half_day_period: Optional[str] = None

class LeaveRequestResponse(LeaveRequestBase):
    id: str
    employee_id: str
    total_days: float
    is_half_day: bool
    half_day_period: Optional[str] = None
    status: LeaveRequestStatus
    hod_skipped: bool = False
    approver_hod_id: Optional[str] = None
    approver_hr_id: Optional[str] = None
    rejection_reason: Optional[str] = None
    cancel_comment: Optional[str] = None
    leave_type_name: Optional[str] = None   # Enriched display field
    last_notified_at: Optional[datetime] = None
    notify_count: int = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class LeaveActionRequest(BaseModel):
    action: str  # APPROVE, REJECT
    rejection_reason: Optional[str] = None

class LeaveBalanceUpdateItem(BaseModel):
    leave_type_id: str
    new_allocated: float

class LeaveBalanceUpdateList(BaseModel):
    updates: List[LeaveBalanceUpdateItem]
