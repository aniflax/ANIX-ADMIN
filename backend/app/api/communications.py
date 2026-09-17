"""Official (bulk) communication endpoint (HR / Admin / SuperAdmin)."""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.dependencies import DbSession, CurrentEmployee
from app.models.employee import RoleEnum, Employee, EmployeeStatusEnum
from app.services.communications import (
    BULK_MODES,
    resolve_bulk_recipients,
    send_bulk_communication,
)


router = APIRouter(prefix="/api/communications", tags=["Official Communication"])


class BulkCommunicationRequest(BaseModel):
    mode: str = Field(..., description=f"One of {sorted(BULK_MODES)}")
    department_id: Optional[str] = None
    roles: Optional[List[str]] = None
    include_ids: Optional[List[str]] = None
    exclude_ids: Optional[List[str]] = None
    subject: Optional[str] = None
    message: str = Field(..., min_length=1, max_length=8000)


class BulkPreviewRequest(BaseModel):
    mode: str
    department_id: Optional[str] = None
    roles: Optional[List[str]] = None
    include_ids: Optional[List[str]] = None
    exclude_ids: Optional[List[str]] = None


class BulkPreviewResponse(BaseModel):
    count: int
    sample: List[dict]


def _require_communicator(current_user: CurrentEmployee) -> None:
    if current_user.role not in (RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only HR, Admin, or SuperAdmin can send official communications.",
        )


@router.get("/accounts")
def list_communication_accounts(
    db: DbSession,
    current_user: CurrentEmployee,
):
    """Return all active accounts with a verified email so the sender can
    build Include/Exclude lists. Includes EMPLOYEE, HOD, HR, ADMIN and
    SUPER_ADMIN — the official communication pool is not restricted to the
    directory view."""
    _require_communicator(current_user)
    rows = (
        db.query(Employee)
        .filter(
            Employee.is_active.is_(True),
            Employee.status == EmployeeStatusEnum.ACTIVE,
            Employee.email.isnot(None),
            Employee.email != "",
            Employee.email_verified.is_(True),
        )
        .order_by(Employee.first_name.asc(), Employee.last_name.asc())
        .all()
    )
    return [
        {
            "id": r.id,
            "employee_id": r.employee_id,
            "first_name": r.first_name,
            "last_name": r.last_name,
            "email": r.email,
            "role": r.role.value if hasattr(r.role, "value") else str(r.role),
            "department_id": r.department_id,
        }
        for r in rows
    ]


@router.post("/bulk/preview", response_model=BulkPreviewResponse)
def preview_bulk_recipients(
    payload: BulkPreviewRequest,
    db: DbSession,
    current_user: CurrentEmployee,
):
    """Return the count and a small sample of recipients for the given selection
    so the sender can confirm before sending. Does NOT send any email."""
    _require_communicator(current_user)
    recipients = resolve_bulk_recipients(
        db,
        mode=payload.mode,
        department_id=payload.department_id,
        roles=payload.roles,
        include_ids=payload.include_ids,
        exclude_ids=payload.exclude_ids,
    )
    sample = [
        {
            "id": r.id,
            "employee_id": r.employee_id,
            "first_name": r.first_name,
            "last_name": r.last_name,
            "email": r.email,
            "role": r.role.value if hasattr(r.role, "value") else str(r.role),
        }
        for r in recipients[:5]
    ]
    return {"count": len(recipients), "sample": sample}


@router.post("/bulk")
def send_bulk_communication_endpoint(
    payload: BulkCommunicationRequest,
    db: DbSession,
    current_user: CurrentEmployee,
):
    """Send an official email to the resolved recipients. Returns a delivery summary."""
    _require_communicator(current_user)
    result = send_bulk_communication(
        db,
        actor=current_user,
        mode=payload.mode,
        subject=payload.subject or "Official Communication from anix HRMS",
        body=payload.message,
        department_id=payload.department_id,
        roles=payload.roles,
        include_ids=payload.include_ids,
        exclude_ids=payload.exclude_ids,
    )
    return result
