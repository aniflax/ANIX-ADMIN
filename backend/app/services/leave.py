from sqlalchemy import case, func
from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from typing import List
from datetime import datetime, date, timedelta
from app.models.leave import LeaveType, LeaveBalance, LeaveRequest, LeaveRequestStatus
from app.models.employee import Employee, RoleEnum, EmployeeStatusEnum
from app.core.security import verify_password
from app.schemas.leave import LeaveTypeCreate, LeaveTypeUpdate, LeaveRequestCreate
from app.services.attendance import get_local_now
from app.services.week_off_history import get_effective_week_off_day

_DAY_NAME_TO_NUM = {"Sunday": 0, "Monday": 1, "Tuesday": 2, "Wednesday": 3, "Thursday": 4, "Friday": 5, "Saturday": 6}
_DAY_NUM_TO_NAME = {v: k for k, v in _DAY_NAME_TO_NUM.items()}
WEEK_OFF_TYPE_NAME = "Week Off"

def _sun_based_weekday(d: date) -> int:
    """Return weekday with Sunday=0 ... Saturday=6."""
    return (d.weekday() + 1) % 7

def _default_week_off_date(anchor_date: date, default_week_off: str | None) -> date:
    """Return the default week-off date in the Sun-Sat week containing anchor_date."""
    default_wo_num = _DAY_NAME_TO_NUM.get(default_week_off or "Sunday", 0)
    return _week_sunday(anchor_date) + timedelta(days=default_wo_num)

def _get_swap_window(today: date, default_week_off: str | None) -> tuple[date, date]:
    """Return the active swap window for the user's next eligible week-off."""
    this_week_default = _default_week_off_date(today, default_week_off)
    if today < this_week_default:
        return today, this_week_default - timedelta(days=1)
    if today == this_week_default:
        next_week_default = this_week_default + timedelta(days=7)
        return today + timedelta(days=1), next_week_default - timedelta(days=1)

    next_week_default = this_week_default + timedelta(days=7)
    return today, next_week_default - timedelta(days=1)

def _same_sun_week(left: date, right: date) -> bool:
    return _week_sunday(left) == _week_sunday(right)

def _target_default_for_swap(swap_date: date, default_week_off: str | None) -> date:
    """Return the default week-off date that the swap request replaces."""
    same_week_default = _default_week_off_date(swap_date, default_week_off)
    if swap_date < same_week_default:
        return same_week_default
    return same_week_default + timedelta(days=7)

def _week_sunday(d: date) -> date:
    """Return the Sunday that starts the Sun-Sat week containing date d."""
    dow_sun = (d.weekday() + 1) % 7   # 0=Sun, 1=Mon … 6=Sat
    return d - timedelta(days=dow_sun)


def _effective_leave_days(db: Session, employee: Employee, start_date: date, end_date: date) -> int:
    week_off_dates = {
        start_date + timedelta(days=offset)
        for offset in range((end_date - start_date).days + 1)
        if _sun_based_weekday(start_date + timedelta(days=offset)) == _DAY_NAME_TO_NUM.get(
            get_effective_week_off_day(db, employee.id, start_date + timedelta(days=offset), employee.default_week_off),
            0,
        )
    }

    week_off_type = db.query(LeaveType).filter(LeaveType.name == WEEK_OFF_TYPE_NAME).first()
    if week_off_type:
        swaps = db.query(LeaveRequest).filter(
            LeaveRequest.employee_id == employee.id,
            LeaveRequest.leave_type_id == week_off_type.id,
            LeaveRequest.status.in_([
                LeaveRequestStatus.PENDING,
                LeaveRequestStatus.HOD_APPROVED,
                LeaveRequestStatus.APPROVED,
            ]),
            LeaveRequest.start_date <= end_date,
            LeaveRequest.end_date >= start_date,
        ).all()
        for swap in swaps:
            week_off_dates.discard(_target_default_for_swap(swap.start_date, employee.default_week_off))
            week_off_dates.add(swap.start_date)

    total_days = (end_date - start_date).days + 1
    return total_days - len({day for day in week_off_dates if start_date <= day <= end_date})


def _get_or_create_week_off_type(db: Session) -> LeaveType:
    week_off_type = db.query(LeaveType).filter(LeaveType.name == WEEK_OFF_TYPE_NAME).first()
    if week_off_type:
        if not week_off_type.is_active:
            week_off_type.is_active = True
            db.add(week_off_type)
            db.commit()
            db.refresh(week_off_type)
        return week_off_type

    week_off_type = LeaveType(
        name=WEEK_OFF_TYPE_NAME,
        description="System internal leave type for default week-off swap requests.",
        annual_quota=0,
        max_consecutive_days=1,
        is_active=True,
    )
    db.add(week_off_type)
    db.commit()
    db.refresh(week_off_type)
    return week_off_type


def get_week_off_usage(db: Session, employee_id: str, target_date: date) -> tuple[int, int]:
    """Return approved and pending week-off usage for the swap cycle ending on target_date."""
    week_off_type = _get_or_create_week_off_type(db)

    employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if not employee:
        return 0, 0

    requests = db.query(LeaveRequest).filter(
        LeaveRequest.employee_id == employee_id,
        LeaveRequest.leave_type_id == week_off_type.id,
        LeaveRequest.status.in_([
            LeaveRequestStatus.PENDING,
            LeaveRequestStatus.HOD_APPROVED,
            LeaveRequestStatus.APPROVED
        ])
    ).all()

    approved = 0
    pending = 0
    for req in requests:
        if _target_default_for_swap(req.start_date, employee.default_week_off) != target_date:
            continue
        if req.status == LeaveRequestStatus.APPROVED:
            approved += 1
        else:
            pending += 1

    return approved, pending

def get_leave_types(db: Session, active_only: bool = True) -> List[LeaveType]:
    query = db.query(LeaveType)
    if active_only:
        query = query.filter(LeaveType.is_active == True)
    query = query.filter(LeaveType.name != WEEK_OFF_TYPE_NAME)
    return query.all()

def create_leave_type(db: Session, leave_data: LeaveTypeCreate, current_user: Employee) -> LeaveType:
    if current_user.role not in [RoleEnum.HR, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Only HR can create leave types")
    normalized_name = leave_data.name.strip()
    if normalized_name.lower() == WEEK_OFF_TYPE_NAME.lower():
        raise HTTPException(status_code=400, detail="Week Off is a system default and cannot be managed as a leave type")
    existing = db.query(LeaveType).filter(func.lower(LeaveType.name) == normalized_name.lower()).first()
    if existing:
        if existing.is_active:
            raise HTTPException(status_code=400, detail="Leave type name already exists")

        existing.name = normalized_name
        existing.description = leave_data.description
        existing.annual_quota = leave_data.annual_quota
        existing.max_consecutive_days = leave_data.max_consecutive_days
        existing.is_active = True
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return existing

    leave_type = LeaveType(**leave_data.dict(exclude={"name"}), name=normalized_name)
    db.add(leave_type)
    db.commit()
    db.refresh(leave_type)
    return leave_type

def update_leave_type(db: Session, type_id: str, update_data: LeaveTypeUpdate, current_user: Employee) -> LeaveType:
    if current_user.role not in [RoleEnum.HR, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Only HR can modify leave types")

    leave_type = db.query(LeaveType).filter(LeaveType.id == type_id).first()
    if not leave_type:
        raise HTTPException(status_code=404, detail="Leave type not found")

    if leave_type.name == WEEK_OFF_TYPE_NAME:
        raise HTTPException(status_code=403, detail="The system default Week Off category cannot be modified")

    update_dict = update_data.dict(exclude_unset=True)
    for key, value in update_dict.items():
        setattr(leave_type, key, value)

    db.add(leave_type)
    db.commit()
    db.refresh(leave_type)

    # Optional: if annual quota changed, we could decide to update current balances,
    # but that's complex. For simplicity, we just change the type definition constraint.
    return leave_type

def delete_leave_type(db: Session, type_id: str, password: str, current_user: Employee):
    if current_user.role not in [RoleEnum.HR, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Only HR can delete leave types")

    # Verify password
    if not verify_password(password, current_user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid password for confirmation")

    leave_type = db.query(LeaveType).filter(LeaveType.id == type_id).first()
    if not leave_type:
        raise HTTPException(status_code=404, detail="Leave type not found")

    if leave_type.name == WEEK_OFF_TYPE_NAME:
        raise HTTPException(status_code=403, detail="The system default Week Off category cannot be deleted")

    # Keep historical leave requests intact, but remove balance cards from profiles.
    leave_type.is_active = False
    db.query(LeaveBalance).filter(LeaveBalance.leave_type_id == type_id).delete(synchronize_session=False)
    db.add(leave_type)
    db.commit()

def get_leave_balances(db: Session, employee_id: str, year: int) -> List[LeaveBalance]:
    active_types = db.query(LeaveType).filter(
        LeaveType.is_active == True,
        LeaveType.name != WEEK_OFF_TYPE_NAME,
    ).all()

    for lt in active_types:
        existing = db.query(LeaveBalance).filter(
            LeaveBalance.employee_id == employee_id,
            LeaveBalance.leave_type_id == lt.id,
            LeaveBalance.year == year
        ).first()

        employee = db.query(Employee).filter(Employee.id == employee_id).first()
        total_allocated = lt.annual_quota

        # Pro-rata logic for joining year
        if employee and employee.activated_at and year == employee.activated_at.year:
            join_month = employee.activated_at.month
            months_remaining = 12 - join_month + 1
            # Round to nearest 0.5 for clean balance
            total_allocated = round((lt.annual_quota * months_remaining / 12) * 2) / 2
        elif employee and employee.activated_at and year < employee.activated_at.year:
            total_allocated = 0
        if not existing:
            new_bal = LeaveBalance(
                employee_id=employee_id,
                leave_type_id=lt.id,
                year=year,
                total_allocated=total_allocated,
                used=0,
                pending=0
            )
            db.add(new_bal)

    db.commit()

    return db.query(LeaveBalance).filter(
        LeaveBalance.employee_id == employee_id,
        LeaveBalance.year == year
    ).join(LeaveType, LeaveBalance.leave_type_id == LeaveType.id
    ).filter(
        LeaveType.is_active == True,
        LeaveType.name != WEEK_OFF_TYPE_NAME,
    ).all()

def apply_for_leave(db: Session, request_data: LeaveRequestCreate, current_user: Employee) -> LeaveRequest:
    from datetime import date
    from app.models.employee import Employee as EmployeeModel

    if current_user.role in [RoleEnum.SUPER_ADMIN, RoleEnum.ADMIN, RoleEnum.HR]:
        raise HTTPException(status_code=403, detail="Leaves are available only for Employee and HOD accounts")

    # Basic validation
    if request_data.start_date > request_data.end_date:
        raise HTTPException(status_code=400, detail="Start date must be before end date")

    if not current_user.activated_at or request_data.start_date < current_user.activated_at.date():
        raise HTTPException(status_code=400, detail="Leave can be applied only from the account activation date")

    # Check for overlapping leaves - no day can be in more than one active leave plan
    # Get all active (pending or approved) leave requests for this employee
    from app.models.leave import LeaveType

    active_statuses = [
        LeaveRequestStatus.PENDING,
        LeaveRequestStatus.HOD_APPROVED,
        LeaveRequestStatus.APPROVED
    ]

    # Fetch existing active leaves with their type names for better error reporting
    conflicting_request = db.query(LeaveRequest, LeaveType.name).join(
        LeaveType, LeaveRequest.leave_type_id == LeaveType.id
    ).filter(
        LeaveRequest.employee_id == current_user.id,
        LeaveRequest.status.in_(active_statuses),
        LeaveType.name != WEEK_OFF_TYPE_NAME,
        LeaveRequest.start_date <= request_data.end_date,
        LeaveRequest.end_date >= request_data.start_date
    ).first()

    if conflicting_request:
        req, type_name = conflicting_request
        raise HTTPException(
            status_code=400,
            detail=(
                f"Date overlap detected! You already have an active {type_name} "
                f"request for {req.start_date} to {req.end_date}. "
                "Please cancel or modify the existing request first."
            )
        )

    total_days = _effective_leave_days(db, current_user, request_data.start_date, request_data.end_date)
    half_day_period = None

    if request_data.is_half_day:
        if request_data.start_date != request_data.end_date:
            raise HTTPException(status_code=400, detail="Half day leave must be for a single day")
        if request_data.half_day_period not in ("FIRST_HALF", "SECOND_HALF"):
            raise HTTPException(status_code=400, detail="Select whether the half day leave is for first half or second half")
        total_days = 0.5
        half_day_period = request_data.half_day_period
    elif total_days <= 0:
        raise HTTPException(status_code=400, detail="Leave range contains only week-off days")

    # Check leave type limits and balances
    leave_type = db.query(LeaveType).filter(LeaveType.id == request_data.leave_type_id).first()
    if not leave_type or not leave_type.is_active:
        raise HTTPException(status_code=400, detail="Invalid or inactive leave type")
    if leave_type.name == WEEK_OFF_TYPE_NAME:
        raise HTTPException(status_code=400, detail="Use the week-off swap option for Week Off requests")

    if leave_type.max_consecutive_days and total_days > leave_type.max_consecutive_days:
        raise HTTPException(status_code=400, detail=f"Exceeds max consecutive days of {leave_type.max_consecutive_days}")

    current_year = request_data.start_date.year

    # Initialize balances if they don't exist yet
    get_leave_balances(db, current_user.id, current_year)

    balance = db.query(LeaveBalance).filter(
        LeaveBalance.employee_id == current_user.id,
        LeaveBalance.leave_type_id == request_data.leave_type_id,
        LeaveBalance.year == current_year
    ).first()

    if not balance:
        raise HTTPException(status_code=400, detail="No leave balance allocated for this year")

    if (balance.total_allocated - balance.used - balance.pending) < total_days:
        raise HTTPException(status_code=400, detail="Insufficient leave balance")

    # Update pending balance
    balance.pending += total_days
    db.add(balance)

    leave_request = LeaveRequest(
        employee_id=current_user.id,
        leave_type_id=request_data.leave_type_id,
        start_date=request_data.start_date,
        end_date=request_data.end_date,
        total_days=total_days,
        is_half_day=request_data.is_half_day,
        half_day_period=half_day_period,
        reason=request_data.reason,
        status=LeaveRequestStatus.PENDING
    )

    # If applicant is HoD or has no department → go directly to HR (skip HOD approval)

    hod_for_department = None
    if current_user.department_id:
        hod_for_department = db.query(EmployeeModel).filter(
            EmployeeModel.department_id == current_user.department_id,
            EmployeeModel.role == RoleEnum.HOD
        ).first()

    # Status logic: Start as PENDING (needs HOD approval)
    leave_request.status = LeaveRequestStatus.PENDING

    # Skip HOD step IF:
    # 1. Applicant is an HOD
    # 2. Applicant has NO department assigned
    # 3. HOD exists for the department but is currently ON LEAVE

    should_skip = False
    if current_user.role == RoleEnum.HOD or not current_user.department_id:
        should_skip = True
    elif hod_for_department and hod_for_department.is_on_leave:
        should_skip = True

    if should_skip:
        leave_request.status = LeaveRequestStatus.HOD_APPROVED
        leave_request.hod_skipped = True

    db.add(leave_request)
    db.commit()
    db.refresh(leave_request)
    return leave_request

def approve_leave(db: Session, request_id: str, action: str, approver: Employee, rejection_reason: str = None) -> LeaveRequest:
    leave_req = db.query(LeaveRequest).filter(LeaveRequest.id == request_id).first()
    if not leave_req:
        raise HTTPException(status_code=404, detail="Request not found")

    is_hod = approver.role == RoleEnum.HOD
    is_admin = approver.role in [RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]
    is_hr = approver.role in [RoleEnum.HR, RoleEnum.SUPER_ADMIN, RoleEnum.ADMIN]

    if not is_hod and not is_hr:
        raise HTTPException(status_code=403, detail="Not authorized to approve leaves")

    # Check if HoD is on leave - if so, HR becomes sole approver
    def is_hod_on_leave(department_id):
        if not department_id:
            return False
        from app.models.employee import Employee
        hod = db.query(Employee).filter(Employee.department_id == department_id, Employee.role == RoleEnum.HOD).first()
        return hod and hod.is_on_leave

    # Get applicant's department for checking HoD status
    applicant = db.query(Employee).filter(Employee.id == leave_req.employee_id).first()
    hod_is_absent = is_hod_on_leave(applicant.department_id) if applicant else False

    if action == "REJECT":
        leave_req.status = LeaveRequestStatus.REJECTED
        leave_req.rejection_reason = rejection_reason if rejection_reason else ""
        if is_hod:
            leave_req.approver_hod_id = approver.id
        else:
            leave_req.approver_hr_id = approver.id

        # Revert pending balance
        balance = db.query(LeaveBalance).filter(
            LeaveBalance.employee_id == leave_req.employee_id,
            LeaveBalance.leave_type_id == leave_req.leave_type_id,
            LeaveBalance.year == leave_req.start_date.year
        ).first()
        leave_type = db.query(LeaveType).filter(LeaveType.id == leave_req.leave_type_id).first()
        if balance and leave_type and leave_type.name != WEEK_OFF_TYPE_NAME:
            balance.pending -= leave_req.total_days
            db.add(balance)

    elif action == "APPROVE":
        # HOD can approve PENDING requests only if HOD is NOT on leave
        # Admin/SuperAdmin can act on behalf of the HOD when delegated approval is needed.
        if leave_req.status == LeaveRequestStatus.PENDING and is_hod and not hod_is_absent:
            leave_req.status = LeaveRequestStatus.HOD_APPROVED
            leave_req.approver_hod_id = approver.id
        elif leave_req.status == LeaveRequestStatus.PENDING and is_admin:
            leave_req.status = LeaveRequestStatus.HOD_APPROVED
            leave_req.approver_hod_id = approver.id
        # HR can approve PENDING when HOD is on leave, or HOD_APPROVED requests
        elif leave_req.status == LeaveRequestStatus.PENDING and is_hr and hod_is_absent:
            leave_req.status = LeaveRequestStatus.APPROVED
            leave_req.approver_hr_id = approver.id
        elif leave_req.status == LeaveRequestStatus.HOD_APPROVED and is_hr:
            leave_req.status = LeaveRequestStatus.APPROVED
            leave_req.approver_hr_id = approver.id

            # Finalize balance changes
            balance = db.query(LeaveBalance).filter(
                LeaveBalance.employee_id == leave_req.employee_id,
                LeaveBalance.leave_type_id == leave_req.leave_type_id,
                LeaveBalance.year == leave_req.start_date.year
            ).first()
            leave_type = db.query(LeaveType).filter(LeaveType.id == leave_req.leave_type_id).first()
            if balance and leave_type and leave_type.name != WEEK_OFF_TYPE_NAME:
                balance.pending -= leave_req.total_days
                balance.used += leave_req.total_days
                db.add(balance)
        else:
            raise HTTPException(status_code=400, detail="Invalid approval state transition")

    leave_req.updated_at = get_local_now()
    db.add(leave_req)
    db.commit()
    db.refresh(leave_req)
    return leave_req


NOTIFY_COOLDOWN_HOURS = 24


def _resolve_pending_approver(db: Session, leave_req: LeaveRequest):
    """Return (recipient_employee, target_role) the request is currently waiting on.

    - PENDING  → waiting on the HOD of the requester's department.
    - HOD_APPROVED (and not yet APPROVED/REJECTED) → waiting on HR.
    Returns (None, None) if the request is not waiting on anyone (e.g. final
    state already reached).
    """
    if leave_req.status == LeaveRequestStatus.PENDING:
        requester = db.query(Employee).filter(Employee.id == leave_req.employee_id).first()
        if not requester or not requester.department_id:
            return None, None
        if leave_req.hod_skipped:
            return _resolve_any_hr(db), "HR"
        hod = db.query(Employee).filter(
            Employee.department_id == requester.department_id,
            Employee.role == RoleEnum.HOD,
        ).first()
        if not hod:
            return _resolve_any_hr(db), "HR"
        return hod, "HOD"

    if leave_req.status == LeaveRequestStatus.HOD_APPROVED:
        return _resolve_any_hr(db), "HR"

    return None, None


def _resolve_any_hr(db: Session):
    """Pick the person who should receive the HOD_APPROVED notification.

    Preference order: active HR → SUPER_ADMIN → ADMIN.  The previous
    implementation ordered by ``role.asc()`` which — for our enum
    (SUPER_ADMIN, ADMIN, HR, ...) — returned the SUPER_ADMIN first
    and the HR accounts (who are the real approvers) were skipped.  We
    now query HR explicitly and fall back to SUPER_ADMIN/ADMIN only
    when no HR exists.
    """
    from sqlalchemy import case
    hr = (
        db.query(Employee)
        .filter(
            Employee.role == RoleEnum.HR,
            Employee.is_active.is_(True),
            Employee.status == EmployeeStatusEnum.ACTIVE,
        )
        .order_by(Employee.first_name.asc())
        .first()
    )
    if hr:
        return hr
    fallback = (
        db.query(Employee)
        .filter(
            Employee.role.in_([RoleEnum.SUPER_ADMIN, RoleEnum.ADMIN]),
            Employee.is_active.is_(True),
            Employee.status == EmployeeStatusEnum.ACTIVE,
        )
        .order_by(case((Employee.role == RoleEnum.SUPER_ADMIN, 0), else_=1))
        .first()
    )
    return fallback


def notify_pending_approver(
    db: Session,
    request_id: str,
    actor: Employee,
) -> dict:
    """Send a reminder email to the next pending approver.

    Enforces a 24-hour cooldown from the last notification. The cooldown is
    tracked per request via ``last_notified_at`` and is independent of the
    actor — any approver (or the requester via HR) clicking Notify within the
    cooldown gets the same 24h lockout.
    """
    from app.services.notifications import send_leave_pending_notification_email

    leave_req = db.query(LeaveRequest).filter(LeaveRequest.id == request_id).first()
    if not leave_req:
        raise HTTPException(status_code=404, detail="Leave request not found.")

    if leave_req.status not in (LeaveRequestStatus.PENDING, LeaveRequestStatus.HOD_APPROVED):
        raise HTTPException(
            status_code=400,
            detail="Only pending requests can be notified.",
        )

    if leave_req.last_notified_at:
        elapsed = get_local_now() - leave_req.last_notified_at
        if elapsed < timedelta(hours=NOTIFY_COOLDOWN_HOURS):
            remaining = timedelta(hours=NOTIFY_COOLDOWN_HOURS) - elapsed
            minutes_left = max(1, int(remaining.total_seconds() // 60))
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Notification already sent recently. Try again in ~{minutes_left} minute(s)."
                ),
            )

    recipient, target_role = _resolve_pending_approver(db, leave_req)
    if not recipient:
        raise HTTPException(
            status_code=400,
            detail="No active approver is configured for this request.",
        )

    requester = db.query(Employee).filter(Employee.id == leave_req.employee_id).first()
    leave_type = db.query(LeaveType).filter(LeaveType.id == leave_req.leave_type_id).first()
    leave_type_name = leave_type.name if leave_type else "Leave"

    email_sent = send_leave_pending_notification_email(
        db,
        recipient=recipient,
        requester=requester,
        leave_type_name=leave_type_name,
        start_date=leave_req.start_date,
        end_date=leave_req.end_date,
        total_days=leave_req.total_days,
        reason=leave_req.reason,
        target_role=target_role,
        request_id=leave_req.id,
    )

    leave_req.last_notified_at = get_local_now()
    leave_req.notify_count = (leave_req.notify_count or 0) + 1
    leave_req.updated_at = get_local_now()
    db.add(leave_req)
    db.commit()
    db.refresh(leave_req)

    return {
        "message": (
            f"Notification email sent to {recipient.first_name} {recipient.last_name}."
            if email_sent
            else "Notification recorded, but email could not be sent (recipient has no email configured)."
        ),
        "last_notified_at": leave_req.last_notified_at,
        "notify_count": leave_req.notify_count,
        "notified_target": target_role,
        "email_sent": email_sent,
    }


# ── Week-Off Stateless Helpers ───────────────────────────────────────────────────

def auto_cancel_week_offs(db: Session) -> int:
    """
    Cancel all PENDING/HOD_APPROVED Week Off requests where today is on or after
    the swap date (start_date).  A swap must be approved *before* the swap date;
    once the day arrives it is too late and the request is auto-cancelled.
    Call this lazily (on balance fetch) or from a scheduled endpoint.
    Returns the number of requests cancelled.
    """
    week_off_type = _get_or_create_week_off_type(db)

    today = date.today()
    pending_wos = db.query(LeaveRequest).filter(
        LeaveRequest.leave_type_id == week_off_type.id,
        LeaveRequest.status.in_([LeaveRequestStatus.PENDING, LeaveRequestStatus.HOD_APPROVED])
    ).all()

    cancelled = 0
    for req in pending_wos:
        # If today >= the swap date, the window has passed — cancel
        if today >= req.start_date:
            req.status = LeaveRequestStatus.CANCELLED
            db.add(req)
            cancelled += 1

    if cancelled:
        db.commit()
    return cancelled


def apply_week_off_swap(db: Session, employee_id: str, swap_date: date) -> dict:
    """
    Apply for a week-off swap.
    Swaps the default week-off day with the selected working day.
    """
    today = date.today()
    week_off_type = _get_or_create_week_off_type(db)

    # Get employee
    employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    if employee.role in [RoleEnum.SUPER_ADMIN, RoleEnum.ADMIN, RoleEnum.HR]:
        raise HTTPException(status_code=403, detail="Week-off swap is available only for Employee and HOD accounts")

    swap_start, swap_end = _get_swap_window(today, employee.default_week_off)

    # Validate swap date is within window
    if swap_date < swap_start or swap_date > swap_end:
        raise HTTPException(
            status_code=400,
            detail=f"Swap date must be between {swap_start} and {swap_end}"
        )

    # Check swap date is not the default week-off day
    if _sun_based_weekday(swap_date) == _DAY_NAME_TO_NUM.get(employee.default_week_off or "Sunday", 0):
        raise HTTPException(status_code=400, detail="Cannot swap with your default week-off day")

    # Check if already have a week-off for the same swap cycle.
    target_default_date = _target_default_for_swap(swap_date, employee.default_week_off)
    existing_wos = db.query(LeaveRequest).filter(
        LeaveRequest.employee_id == employee_id,
        LeaveRequest.leave_type_id == week_off_type.id,
        LeaveRequest.status.in_([LeaveRequestStatus.PENDING, LeaveRequestStatus.HOD_APPROVED, LeaveRequestStatus.APPROVED])
    ).all()

    for ewo in existing_wos:
        if _target_default_for_swap(ewo.start_date, employee.default_week_off) == target_default_date:
            raise HTTPException(status_code=400, detail="You already have a week-off swap for this cycle")

    # Check for overlapping leaves
    active_statuses = [LeaveRequestStatus.PENDING, LeaveRequestStatus.HOD_APPROVED, LeaveRequestStatus.APPROVED]
    conflicting = db.query(LeaveRequest).filter(
        LeaveRequest.employee_id == employee_id,
        LeaveRequest.status.in_(active_statuses),
        LeaveRequest.leave_type_id != week_off_type.id,
        LeaveRequest.start_date <= swap_date,
        LeaveRequest.end_date >= swap_date
    ).first()

    if conflicting:
        raise HTTPException(
            status_code=400,
            detail=f"You have an active leave request ({conflicting.start_date} to {conflicting.end_date}) on this date. Please cancel it first."
        )

    # Create the week-off swap request
    leave_request = LeaveRequest(
        employee_id=employee_id,
        leave_type_id=week_off_type.id,
        start_date=swap_date,
        end_date=swap_date,
        total_days=1,
        reason=f"Week Off Swap - Swapping {employee.default_week_off or 'Sunday'} for {swap_date.strftime('%A')}",
        status=LeaveRequestStatus.PENDING
    )

    # Check if HOD exists for department
    hod_for_department = None
    if employee.department_id:
        hod_for_department = db.query(Employee).filter(
            Employee.department_id == employee.department_id,
            Employee.role == RoleEnum.HOD
        ).first()

    # Skip HOD if no HOD exists, the applicant is HOD, or the department HOD is on leave.
    if not hod_for_department or employee.role == RoleEnum.HOD or (hod_for_department and hod_for_department.is_on_leave):
        leave_request.status = LeaveRequestStatus.HOD_APPROVED
        leave_request.hod_skipped = True

    db.add(leave_request)
    db.commit()
    db.refresh(leave_request)
    leave_request.leave_type_name = WEEK_OFF_TYPE_NAME

    return leave_request


def get_week_off_status(db: Session, employee_id: str) -> dict:
    """
    Live weekly snapshot for the Week Off widget.
    Also triggers lazy auto-cancel as a side-effect.
    """
    # Run cleanup first (lazy auto-cancel)
    auto_cancel_week_offs(db)

    today = date.today()
    week_off_type = _get_or_create_week_off_type(db)
    employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    if employee.role in [RoleEnum.SUPER_ADMIN, RoleEnum.ADMIN, RoleEnum.HR]:
        raise HTTPException(status_code=403, detail="Week-off swap is available only for Employee and HOD accounts")

    swap_start, swap_end = _get_swap_window(today, employee.default_week_off)
    target_default_date = _target_default_for_swap(swap_end, employee.default_week_off)

    approved, pending = get_week_off_usage(db, employee_id, target_default_date)

    # Find current week’s request
    current_request = None
    if week_off_type:
        all_wos = db.query(LeaveRequest).filter(
            LeaveRequest.employee_id == employee_id,
            LeaveRequest.leave_type_id == week_off_type.id,
            LeaveRequest.status.in_([
                LeaveRequestStatus.PENDING,
                LeaveRequestStatus.HOD_APPROVED,
                LeaveRequestStatus.APPROVED,
            ])
        ).all()
        for req in all_wos:
            if _target_default_for_swap(req.start_date, employee.default_week_off) == target_default_date:
                current_request = {
                    "id": str(req.id),
                    "date": str(req.start_date),
                    "status": req.status.value,
                }
                break

    return {
        "default_week_off_day": employee.default_week_off or "Sunday",
        "default_week_off_date": str(target_default_date),
        "applicable_week_start": str(swap_start),
        "applicable_week_end": str(swap_end),
        "approved_this_week": approved,
        "pending_this_week": pending,
        "available": approved == 0 and pending == 0,
        "current_request": current_request,
        "week_off_type_id": str(week_off_type.id) if week_off_type else None,
    }
def update_employee_leave_balances(db: Session, employee_id: str, updates: List, current_user: Employee):
    """Manually update leave balances for a employee."""
    employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    # Permission checks
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Not authorized to modify balances")

    if current_user.role == RoleEnum.HR:
        if employee.hr_leave_modified:
            raise HTTPException(status_code=403, detail="HR can only modify balances once per account")
        if not employee.activated_at or employee.activated_at.date() != date.today():
            raise HTTPException(status_code=403, detail="HR can only modify balances on the activation day")

    current_year = date.today().year
    # Ensure balances exist
    get_leave_balances(db, employee_id, current_year)

    for item in updates:
        balance = db.query(LeaveBalance).filter(
            LeaveBalance.employee_id == employee_id,
            LeaveBalance.leave_type_id == item.leave_type_id,
            LeaveBalance.year == current_year
        ).first()

        if balance:
            balance.total_allocated = item.new_allocated
            db.add(balance)

    if current_user.role == RoleEnum.HR:
        employee.hr_leave_modified = True
        db.add(employee)

    db.commit()
    return {"message": "Balances updated successfully"}
