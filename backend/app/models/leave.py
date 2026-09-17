import uuid
import enum
from datetime import datetime, date
from sqlalchemy import String, Boolean, DateTime, Integer, Date, Enum as SAEnum, ForeignKey, Text, Float
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.core.timezone import get_local_now

class LeaveRequestStatus(str, enum.Enum):
    PENDING = "PENDING"
    HOD_APPROVED = "HOD_APPROVED"
    APPROVED = "APPROVED"  # Final HR approval
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"

class LeaveType(Base):
    __tablename__ = "leave_types"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    annual_quota: Mapped[int] = mapped_column(Integer, default=0)
    max_consecutive_days: Mapped[int] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=get_local_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=get_local_now, onupdate=get_local_now)

class LeaveBalance(Base):
    __tablename__ = "leave_balances"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    leave_type_id: Mapped[str] = mapped_column(String(36), ForeignKey("leave_types.id"), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    total_allocated: Mapped[float] = mapped_column(Float, default=0.0)
    used: Mapped[float] = mapped_column(Float, default=0.0)
    pending: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=get_local_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=get_local_now, onupdate=get_local_now)

class LeaveRequest(Base):
    __tablename__ = "leave_requests"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    leave_type_id: Mapped[str] = mapped_column(String(36), ForeignKey("leave_types.id"), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    total_days: Mapped[float] = mapped_column(Float, nullable=False)
    is_half_day: Mapped[bool] = mapped_column(Boolean, default=False)
    half_day_period: Mapped[str | None] = mapped_column(String(20), nullable=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[LeaveRequestStatus] = mapped_column(
        SAEnum(LeaveRequestStatus), nullable=False, default=LeaveRequestStatus.PENDING
    )
    hod_skipped: Mapped[bool] = mapped_column(Boolean, default=False)
    approver_hod_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=True)
    approver_hr_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=True)
    rejection_reason: Mapped[str] = mapped_column(Text, nullable=True)
    cancel_comment: Mapped[str] = mapped_column(Text, nullable=True)
    last_notified_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    notify_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=get_local_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=get_local_now, onupdate=get_local_now)
