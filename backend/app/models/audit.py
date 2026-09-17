import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.core.timezone import get_local_now


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True,
        default=lambda: str(uuid.uuid4())
    )
    performed_by: Mapped[str] = mapped_column(
        String(36), nullable=False
    )  # UUID of who performed the action
    entity_type: Mapped[str] = mapped_column(
        String(100), nullable=False
    )  # e.g. leave_request, employee, attendance
    entity_id: Mapped[str] = mapped_column(
        String(36), nullable=False
    )  # UUID of the affected record
    action: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # CREATED, UPDATED, APPROVED, REJECTED, LOCKED etc.
    old_values: Mapped[dict] = mapped_column(JSON, nullable=True)
    new_values: Mapped[dict] = mapped_column(JSON, nullable=True)
    ip_address: Mapped[str] = mapped_column(String(45), nullable=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime, default=get_local_now
    )