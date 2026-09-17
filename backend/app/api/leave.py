from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Optional
from datetime import date, datetime
from pydantic import BaseModel
from app.core.dependencies import DbSession, CurrentEmployee
from app.services.attendance import get_local_now
from app.schemas.leave import (
    LeaveTypeResponse, LeaveTypeCreate, LeaveBalanceResponse,
    LeaveRequestResponse, LeaveRequestCreate, LeaveActionRequest,
    LeaveTypeUpdate, LeaveTypeDeleteRequest, LeaveBalanceUpdateList
)
from app.services.leave import (
    get_leave_types, create_leave_type, get_leave_balances, apply_for_leave, approve_leave,
    update_leave_type, delete_leave_type, get_week_off_status, auto_cancel_week_offs,
    apply_week_off_swap as apply_week_off_swap_service, update_employee_leave_balances,
    notify_pending_approver,
)
from app.models.leave import LeaveRequest


class WeekOffSwapRequest(BaseModel):
    swap_date: date

router = APIRouter(prefix="/api/leave", tags=["Leave Management"])

@router.get("/types", response_model=List[LeaveTypeResponse])
def fetch_leave_types(db: DbSession, current_user: CurrentEmployee):
    """Get all active leave types."""
    return get_leave_types(db=db)

@router.post("/types", response_model=LeaveTypeResponse)
def add_leave_type(leave_data: LeaveTypeCreate, db: DbSession, current_user: CurrentEmployee):
    """Add a new leave type (HR only)."""
    return create_leave_type(db=db, leave_data=leave_data, current_user=current_user)

@router.put("/types/{type_id}", response_model=LeaveTypeResponse)
def modify_leave_type(type_id: str, leave_data: LeaveTypeUpdate, db: DbSession, current_user: CurrentEmployee):
    """Update an existing leave type (HR only)."""
    return update_leave_type(db=db, type_id=type_id, update_data=leave_data, current_user=current_user)

@router.delete("/types/{type_id}")
def remove_leave_type(type_id: str, delete_req: LeaveTypeDeleteRequest, db: DbSession, current_user: CurrentEmployee):
    """Delete a leave type (HR only, requires password)."""
    delete_leave_type(db=db, type_id=type_id, password=delete_req.password, current_user=current_user)
    return {"message": "Leave type deleted successfully"}

@router.get("/balances/{employee_id}", response_model=List[LeaveBalanceResponse])
def fetch_balances(employee_id: str, db: DbSession, current_user: CurrentEmployee, year: int = None):
    """Fetch leave balances for a specific user and year."""
    if not year:
        year = get_local_now().year
    
    balances = get_leave_balances(db=db, employee_id=employee_id, year=year)
    # Add computed field "available" dynamically before returning
    res = []
    for b in balances:
        b_dict = {
            "id": b.id, "employee_id": b.employee_id, "leave_type_id": b.leave_type_id,
            "year": b.year, "total_allocated": b.total_allocated, "used": b.used,
            "pending": b.pending, "available": b.total_allocated - b.used - b.pending
        }
        res.append(b_dict)
    return res

@router.put("/balances/{employee_id}")
def modify_balances(employee_id: str, updates: LeaveBalanceUpdateList, db: DbSession, current_user: CurrentEmployee):
    """Manually update leave balances for a employee (Admin/HR)."""
    return update_employee_leave_balances(db=db, employee_id=employee_id, updates=updates.updates, current_user=current_user)

@router.post("/apply", response_model=LeaveRequestResponse)
def apply_leave(request_data: LeaveRequestCreate, db: DbSession, current_user: CurrentEmployee):
    """Apply for leave."""
    return apply_for_leave(db=db, request_data=request_data, current_user=current_user)

@router.post("/action/{request_id}", response_model=LeaveRequestResponse)
def act_on_leave(request_id: str, action_data: LeaveActionRequest, db: DbSession, current_user: CurrentEmployee):
    """Approve or Reject leave request (HoD or HR)."""
    return approve_leave(
        db=db, 
        request_id=request_id, 
        action=action_data.action, 
        approver=current_user,
        rejection_reason=action_data.rejection_reason
    )


@router.post("/notify/{request_id}")
def notify_leave_approver(request_id: str, db: DbSession, current_user: CurrentEmployee):
    """Send a reminder email to the next pending approver (HOD or HR).

    - For HR: used when a request is awaiting HOD approval to nudge the HOD.
    - For HOD: used after HOD approval when the request is awaiting HR.

    Enforces a 24-hour cooldown per request. HOD/HR/Admin/SuperAdmin may call
    this. Employee profiles are not allowed (they cannot trigger approver nudges).
    """
    from app.models.employee import RoleEnum as _RoleEnum
    if current_user.role not in (
        _RoleEnum.HOD,
        _RoleEnum.HR,
        _RoleEnum.ADMIN,
        _RoleEnum.SUPER_ADMIN,
    ):
        raise HTTPException(status_code=403, detail="Not authorized to notify approvers.")
    return notify_pending_approver(db=db, request_id=request_id, actor=current_user)

@router.get("/requests", response_model=List[LeaveRequestResponse])
def fetch_leave_requests(db: DbSession, current_user: CurrentEmployee):
    """Get leave requests relevant to the user's role, enriched with leave type name."""
    from app.models.employee import RoleEnum
    from app.models.leave import LeaveType
    from app.services.leave import auto_cancel_week_offs

    # Auto-cancel expired week-offs before showing requests
    auto_cancel_week_offs(db)

    def enrich(reqs):
        """Attach leave_type_name to each request dict."""
        type_map = {lt.id: lt.name for lt in db.query(LeaveType).all()}
        results = []
        for r in reqs:
            d = {c.name: getattr(r, c.name) for c in r.__table__.columns}
            d["leave_type_name"] = type_map.get(r.leave_type_id, "Unknown")
            results.append(d)
        return results

    if current_user.role == RoleEnum.EMPLOYEE:
        reqs = db.query(LeaveRequest).filter(LeaveRequest.employee_id == current_user.id).all()
        return enrich(reqs)

    elif current_user.role == RoleEnum.HOD:
        from app.models.employee import Employee
        employees_in_dept = db.query(Employee.id).filter(Employee.department_id == current_user.department_id).all()
        dept_employee_ids = [s[0] for s in employees_in_dept]
        reqs = db.query(LeaveRequest).filter(LeaveRequest.employee_id.in_(dept_employee_ids)).all()
        return enrich(reqs)

    elif current_user.role in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        reqs = db.query(LeaveRequest).all()
        return enrich(reqs)

    return []


@router.post("/cancel/{request_id}")
def cancel_leave_request(request_id: str, db: DbSession, current_user: CurrentEmployee, comment: Optional[str] = None):
    """Cancel a pending leave request (own requests only)."""
    from app.models.leave import LeaveRequestStatus, LeaveBalance, LeaveType
    req = db.query(LeaveRequest).filter(LeaveRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Leave request not found.")
    if req.employee_id != current_user.id:
        raise HTTPException(status_code=403, detail="Cannot cancel someone else's leave request.")
    if req.status not in [LeaveRequestStatus.PENDING, LeaveRequestStatus.HOD_APPROVED]:
        raise HTTPException(status_code=400, detail="Only PENDING or HOD_APPROVED requests can be cancelled.")
    
    # Restore pending balance
    balance = db.query(LeaveBalance).filter(
        LeaveBalance.employee_id == current_user.id,
        LeaveBalance.leave_type_id == req.leave_type_id
    ).first()
    leave_type = db.query(LeaveType).filter(LeaveType.id == req.leave_type_id).first()
    if balance and leave_type and leave_type.name != "Week Off":
        balance.pending = max(0, balance.pending - req.total_days)
    
    req.status = LeaveRequestStatus.CANCELLED
    req.cancel_comment = comment
    db.commit()
    db.refresh(req)
    return {"message": "Leave request cancelled successfully.", "id": req.id}


@router.put("/hod-leave-status/{employee_id}")
def update_hod_leave_status(employee_id: str, is_on_leave: bool, db: DbSession, current_user: CurrentEmployee):
    """Mark HoD as on leave or active (HR only). When HoD is on leave, pending approvals auto-transfer to HR."""
    from app.models.employee import Employee, RoleEnum
    
    if current_user.role not in [RoleEnum.HR, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Only HR can update HoD leave status")
    
    hod = db.query(Employee).filter(Employee.id == employee_id, Employee.role == RoleEnum.HOD).first()
    if not hod:
        raise HTTPException(status_code=404, detail="HoD not found")
    
    hod.is_on_leave = is_on_leave
    db.add(hod)
    db.commit()
    db.refresh(hod)
    return {"message": f"HoD {hod.first_name} {hod.last_name} is now {'on leave' if is_on_leave else 'active'}", "is_on_leave": hod.is_on_leave}


@router.get("/week-off/status")
def fetch_week_off_status(db: DbSession, current_user: CurrentEmployee):
    """Live weekly Week-Off status + lazy auto-cancel for the current user."""
    return get_week_off_status(db=db, employee_id=current_user.id)


@router.post("/week-off/swap", response_model=LeaveRequestResponse)
def apply_week_off_swap(request_data: WeekOffSwapRequest, db: DbSession, current_user: CurrentEmployee):
    """Apply for a week-off swap - swap default week-off with selected working day."""
    return apply_week_off_swap_service(db=db, employee_id=current_user.id, swap_date=request_data.swap_date)


@router.post("/maintenance/auto-cancel-week-offs")
def trigger_auto_cancel(db: DbSession, current_user: CurrentEmployee):
    """Manually trigger Week-Off auto-cancel (HR/SuperAdmin only). Also runs lazily on every status fetch."""
    from app.models.employee import RoleEnum
    if current_user.role not in [RoleEnum.HR, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Restricted to HR/SuperAdmin")
    count = auto_cancel_week_offs(db=db)
    return {"message": f"{count} week-off request(s) auto-cancelled.", "cancelled": count}
