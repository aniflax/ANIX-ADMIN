from datetime import date, timedelta

from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.models.attendance import AttendanceLog, AttendanceStatus
from app.models.leave import LeaveRequest, LeaveRequestStatus, LeaveType
from app.models.employee import Employee
from app.models.week_off_history import EmployeeWeekOffHistory


DAY_NAME_TO_NUM = {"Sunday": 0, "Monday": 1, "Tuesday": 2, "Wednesday": 3, "Thursday": 4, "Friday": 5, "Saturday": 6}
WEEK_OFF_TYPE_NAME = "Week Off"
WEEK_OFF_HISTORY_TABLE = "employee_week_off_history"


def _history_table_exists(db: Session) -> bool:
    try:
        return inspect(db.get_bind()).has_table(WEEK_OFF_HISTORY_TABLE)
    except Exception:
        db.rollback()
        return False


def week_sunday(day: date) -> date:
    return day - timedelta(days=(day.weekday() + 1) % 7)


def week_off_date_for_week(anchor_date: date, week_off_day: str | None) -> date:
    return week_sunday(anchor_date) + timedelta(days=DAY_NAME_TO_NUM.get(week_off_day or "Sunday", 0))


def get_week_off_history(db: Session, employee_id: str) -> list[EmployeeWeekOffHistory]:
    if not _history_table_exists(db):
        return []
    return db.query(EmployeeWeekOffHistory).filter(
        EmployeeWeekOffHistory.employee_id == employee_id
    ).order_by(EmployeeWeekOffHistory.effective_from.asc()).all()


def serialize_week_off_history(db: Session, employee: Employee) -> list[dict]:
    history = get_week_off_history(db, employee.id)
    if not history:
        effective_from = (employee.activated_at or employee.created_at).date() if (employee.activated_at or employee.created_at) else date.min
        return [{"week_off_day": employee.default_week_off or "Sunday", "effective_from": effective_from}]
    return [
        {"week_off_day": row.week_off_day, "effective_from": row.effective_from}
        for row in history
    ]


def get_effective_week_off_day(db: Session, employee_id: str, target_date: date, fallback: str | None = "Sunday") -> str:
    if not _history_table_exists(db):
        return fallback or "Sunday"
    row = db.query(EmployeeWeekOffHistory).filter(
        EmployeeWeekOffHistory.employee_id == employee_id,
        EmployeeWeekOffHistory.effective_from <= target_date,
    ).order_by(EmployeeWeekOffHistory.effective_from.desc()).first()
    return row.week_off_day if row else (fallback or "Sunday")


def _current_week_off_consumed(db: Session, employee: Employee, today: date, current_week_off: str | None) -> bool:
    week_start = week_sunday(today)
    week_end = week_start + timedelta(days=6)
    current_week_off_date = week_off_date_for_week(today, current_week_off)

    if current_week_off_date < today:
        return True

    if db.query(AttendanceLog).filter(
        AttendanceLog.employee_id == employee.id,
        AttendanceLog.date >= week_start,
        AttendanceLog.date <= week_end,
        AttendanceLog.status == AttendanceStatus.WEEK_OFF,
    ).first():
        return True

    week_off_type = db.query(LeaveType).filter(LeaveType.name == WEEK_OFF_TYPE_NAME).first()
    if not week_off_type:
        return False

    return db.query(LeaveRequest).filter(
        LeaveRequest.employee_id == employee.id,
        LeaveRequest.leave_type_id == week_off_type.id,
        LeaveRequest.status.in_([LeaveRequestStatus.PENDING, LeaveRequestStatus.HOD_APPROVED, LeaveRequestStatus.APPROVED]),
        LeaveRequest.start_date >= week_start,
        LeaveRequest.start_date <= week_end,
    ).first() is not None


def get_week_off_change_effective_from(db: Session, employee: Employee, new_week_off: str, today: date) -> date:
    # Week-off changes always take effect from the next week, never mid-week.
    return week_sunday(today) + timedelta(days=7)


def apply_week_off_change(db: Session, employee: Employee, new_week_off: str, today: date) -> None:
    if not _history_table_exists(db):
        return
    current_week_off = get_effective_week_off_day(db, employee.id, today, employee.default_week_off)
    if new_week_off == current_week_off and new_week_off == (employee.default_week_off or "Sunday"):
        return

    history = get_week_off_history(db, employee.id)
    if not history:
        initial_from = (employee.activated_at or employee.created_at).date() if (employee.activated_at or employee.created_at) else today
        db.add(EmployeeWeekOffHistory(
            employee_id=employee.id,
            week_off_day=current_week_off or employee.default_week_off or "Sunday",
            effective_from=initial_from,
        ))

    effective_from = get_week_off_change_effective_from(db, employee, new_week_off, today)
    existing = db.query(EmployeeWeekOffHistory).filter(
        EmployeeWeekOffHistory.employee_id == employee.id,
        EmployeeWeekOffHistory.effective_from == effective_from,
    ).first()
    if existing:
        existing.week_off_day = new_week_off
    else:
        db.add(EmployeeWeekOffHistory(
            employee_id=employee.id,
            week_off_day=new_week_off,
            effective_from=effective_from,
        ))
