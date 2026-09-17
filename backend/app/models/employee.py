import uuid
from datetime import datetime, date
from sqlalchemy import String, Boolean, DateTime, Date, Integer, Enum as SAEnum, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
import enum
from app.core.timezone import get_local_now


class RoleEnum(str, enum.Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    ADMIN = "ADMIN"
    HR = "HR"
    HOD = "HOD"
    EMPLOYEE = "EMPLOYEE"


class EmployeeStatusEnum(str, enum.Enum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
    LOCKED = "LOCKED"


class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True,
        default=lambda: str(uuid.uuid4())
    )
    employee_id: Mapped[int] = mapped_column(
        Integer, unique=True, nullable=False
    )  # 5 digit numeric ID e.g. 10001
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(
        String(255), unique=True, nullable=True
    )
    email_verified: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    hashed_password: Mapped[str] = mapped_column(
        String(255), nullable=False
    )
    role: Mapped[RoleEnum] = mapped_column(
        SAEnum(RoleEnum), nullable=False, default=RoleEnum.EMPLOYEE
    )
    status: Mapped[EmployeeStatusEnum] = mapped_column(
        SAEnum(EmployeeStatusEnum),
        nullable=False,
        default=EmployeeStatusEnum.ACTIVE
    )
    failed_login_attempts: Mapped[int] = mapped_column(
        Integer, default=0
    )
    phone: Mapped[str] = mapped_column(String(20), nullable=True)
    address: Mapped[str] = mapped_column(Text, nullable=True)
    
    # Document Paths
    id_proof_path: Mapped[str] = mapped_column(String(500), nullable=True)
    pan_card_path: Mapped[str] = mapped_column(String(500), nullable=True)
    passbook_path: Mapped[str] = mapped_column(String(500), nullable=True)
    department_id: Mapped[str] = mapped_column(String(36), nullable=True)
    default_week_off: Mapped[str] = mapped_column(String(20), default="Sunday", server_default="Sunday")
    is_on_leave: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    date_of_birth: Mapped[date] = mapped_column(Date, nullable=True)
    delete_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    delete_requested_by: Mapped[str] = mapped_column(String(36), nullable=True)
    hr_leave_modified: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    activated_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=get_local_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=get_local_now, onupdate=get_local_now
    )
    last_login: Mapped[datetime] = mapped_column(
        DateTime, nullable=True
    )
    password_reset_token_issued_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=True
    )


class AccountEvent(Base):
    __tablename__ = "account_events"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True,
        default=lambda: str(uuid.uuid4())
    )
    employee_id: Mapped[str] = mapped_column(String(36), nullable=False)
    event_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # LOGIN_FAILED, LOCKED, UNLOCKED, PASSWORD_RESET
    ip_address: Mapped[str] = mapped_column(String(45), nullable=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime, default=get_local_now
    )
    resolved_by: Mapped[str] = mapped_column(String(36), nullable=True)
    resolved_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=True
    )
    notes: Mapped[str] = mapped_column(Text, nullable=True)