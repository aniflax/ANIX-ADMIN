import uuid
import enum
from datetime import datetime, date
from sqlalchemy import String, DateTime, Date, Enum as SAEnum, Float, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.core.timezone import get_local_now

class AttendanceSource(str, enum.Enum):
    MANUAL = "MANUAL"
    BIOMETRIC = "BIOMETRIC"
    WEB = "WEB"
    MOBILE = "MOBILE"

class AttendanceStatus(str, enum.Enum):
    PRESENT = "PRESENT"
    ABSENT = "ABSENT"
    HALF_DAY = "HALF_DAY"
    ON_LEAVE = "ON_LEAVE"
    HOLIDAY = "HOLIDAY"
    WEEK_OFF = "WEEK_OFF"

class AttendanceLog(Base):
    __tablename__ = "attendance_logs"
    __table_args__ = (
        UniqueConstraint("employee_id", "date", name="uq_attendance_logs_employee_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    check_in_time: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    check_out_time: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    status: Mapped[AttendanceStatus] = mapped_column(
        SAEnum(AttendanceStatus), nullable=False, default=AttendanceStatus.PRESENT
    )
    source: Mapped[AttendanceSource] = mapped_column(
        SAEnum(AttendanceSource), nullable=False, default=AttendanceSource.WEB
    )
    location_lat: Mapped[float] = mapped_column(Float, nullable=True)
    location_lng: Mapped[float] = mapped_column(Float, nullable=True)
    geo_flagged: Mapped[bool] = mapped_column(Boolean, default=False)
    is_manual: Mapped[bool] = mapped_column(Boolean, default=False)
    unlocked_by_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=get_local_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=get_local_now, onupdate=get_local_now)
