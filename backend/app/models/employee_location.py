import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.core.timezone import get_local_now

class EmployeeLocation(Base):
    """Multi-location allocation for employees - allows a user to be assigned to multiple department locations."""
    __tablename__ = "employee_locations"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True,
        default=lambda: str(uuid.uuid4())
    )
    employee_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("employees.id"), nullable=False
    )
    department_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("departments.id"), nullable=False
    )
    location_name: Mapped[str] = mapped_column(
        String(200), nullable=True
    )
    location_lat: Mapped[float] = mapped_column(
        Float, nullable=True
    )
    location_lng: Mapped[float] = mapped_column(
        Float, nullable=True
    )
    is_primary: Mapped[bool] = mapped_column(
        Boolean, default=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime, default=get_local_now
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=get_local_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=get_local_now, onupdate=get_local_now
    )