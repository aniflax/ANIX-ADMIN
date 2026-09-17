from fastapi import APIRouter, Depends, HTTPException, status, Response
from fastapi.responses import StreamingResponse
from typing import List, Optional
from datetime import date, timedelta
from pydantic import BaseModel
import json
import anyio
from queue import Empty
from app.core.dependencies import DbSession, CurrentEmployee
from app.schemas.attendance import AttendanceMarkRequest, AttendanceResponse, AttendanceManualUpdate
from app.services.attendance import (
    mark_attendance, mark_week_off, get_weekly_flagged_attendance, 
    get_weekly_attendance, manual_update_attendance,
    is_attendance_reminder_enabled, set_attendance_reminder,
    get_employees_without_attendance_today, get_local_today, get_attendance_deadline,
    get_attendance_reminder_last_sent,
    get_non_compliant_attendance, generate_non_compliant_excel, get_non_compliant_summary,
    serialize_attendance_log
)
from app.services.notifications import process_attendance_reminders
from app.services.notifications import get_official_communication_email
from app.models.employee import RoleEnum, Employee
from app.models.attendance import AttendanceLog
from app.services.attendance_realtime import register_attendance_subscriber, unregister_attendance_subscriber

router = APIRouter(prefix="/api/attendance", tags=["Attendance Management"])

class WeekOffRequest(BaseModel):
    target_date: date

class ReminderToggleRequest(BaseModel):
    enabled: bool

@router.post("/mark", response_model=AttendanceResponse)
def act_mark_attendance(request_data: AttendanceMarkRequest, db: DbSession, current_user: CurrentEmployee):
    """Mark attendance for the current day."""
    return mark_attendance(db=db, request=request_data, current_user=current_user)

@router.get("/stream")
async def attendance_stream(current_user: CurrentEmployee):
    """Real-time attendance change stream for browser clients."""
    subscriber = register_attendance_subscriber()

    async def event_generator():
        try:
            yield "event: ready\ndata: {}\n\n"
            while True:
                try:
                    payload = await anyio.to_thread.run_sync(subscriber.get, True, 15)
                    yield f"event: attendance\ndata: {json.dumps(payload, default=str)}\n\n"
                except Empty:
                    yield ": keepalive\n\n"
        finally:
            unregister_attendance_subscriber(subscriber)

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    })

@router.post("/week-off", response_model=AttendanceResponse)
def act_mark_week_off(request_data: WeekOffRequest, db: DbSession, current_user: CurrentEmployee):
    """Mark a day as week-off."""
    return mark_week_off(db=db, target_date=request_data.target_date, current_user=current_user)

@router.get("/reports/geo-mismatch", response_model=List[AttendanceResponse])
def fetch_mismatch_report(db: DbSession, current_user: CurrentEmployee):
    """Fetch geo-mismatch flagged records for the week. HR and Admin only."""
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail="Not authorized to view reports"
        )
    return get_weekly_flagged_attendance(db=db)

@router.get("/reports/all", response_model=List[AttendanceResponse])
def fetch_all_weekly_report(db: DbSession, current_user: CurrentEmployee):
    """Fetch all attendance records for the week. HR and Admin only."""
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail="Not authorized to view reports"
        )
    return get_weekly_attendance(db=db)

@router.get("/history", response_model=List[AttendanceResponse])
def fetch_own_history(db: DbSession, current_user: CurrentEmployee):
    """Fetch attendance history for the logged-in user."""
    logs = db.query(AttendanceLog).filter(
        AttendanceLog.employee_id == current_user.id
    ).order_by(AttendanceLog.date.desc()).all()
    return [serialize_attendance_log(db, log, current_user) for log in logs]

@router.get("/history/monthly", response_model=List[AttendanceResponse])
def fetch_monthly_history(db: DbSession, current_user: CurrentEmployee, year: int = None, month: int = None):
    """Fetch monthly attendance history for the logged-in user."""
    if year is None:
        year = get_local_today().year
    if month is None:
        month = get_local_today().month
    
    from datetime import timedelta
    start_date = date(year, month, 1)
    if month == 12:
        end_date = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        end_date = date(year, month + 1, 1) - timedelta(days=1)
    
    logs = db.query(AttendanceLog).filter(
        AttendanceLog.employee_id == current_user.id,
        AttendanceLog.date >= start_date,
        AttendanceLog.date <= end_date
    ).order_by(AttendanceLog.date.desc()).all()
    return [serialize_attendance_log(db, log, current_user) for log in logs]


@router.get("/history/employee/{employee_id}", response_model=List[AttendanceResponse])
def fetch_employee_history(
    employee_id: str,
    db: DbSession,
    current_user: CurrentEmployee,
    year: int = None,
    month: int = None,
):
    """Fetch attendance history for a specific employee with role-based access control."""
    target_employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if not target_employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    if current_user.role == RoleEnum.EMPLOYEE and current_user.id != employee_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to view this attendance history")

    if current_user.role == RoleEnum.HOD and current_user.department_id != target_employee.department_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to view this attendance history")

    if current_user.role not in [RoleEnum.EMPLOYEE, RoleEnum.HOD, RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to view this attendance history")

    query = db.query(AttendanceLog).filter(AttendanceLog.employee_id == employee_id)
    if year is not None and month is not None:
        start_date = date(year, month, 1)
        if month == 12:
            end_date = date(year + 1, 1, 1) - timedelta(days=1)
        else:
            end_date = date(year, month + 1, 1) - timedelta(days=1)
        query = query.filter(AttendanceLog.date >= start_date, AttendanceLog.date <= end_date)

    logs = query.order_by(AttendanceLog.date.desc()).all()
    return [serialize_attendance_log(db, log, target_employee) for log in logs]

@router.post("/manual-update", response_model=AttendanceResponse)
def act_manual_update_attendance(request_data: AttendanceManualUpdate, db: DbSession, current_user: CurrentEmployee):
    """Admin/HOD: Manually update or create attendance for a Employee on a specific date."""
    if current_user.role not in [RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN, RoleEnum.HOD, RoleEnum.HR]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail="Not authorized to manually update attendance"
        )
    return manual_update_attendance(db=db, request=request_data, current_user=current_user)

# Attendance Reminder Endpoints (Super Admin only)
@router.get("/reminder/status")
def get_reminder_status(db: DbSession, current_user: CurrentEmployee):
    """Get attendance reminder status. Super Admin only."""
    if current_user.role != RoleEnum.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admin can view reminder status"
        )
    deadline = get_attendance_deadline(db)
    try:
        from datetime import datetime
        deadline_display = datetime.strptime(deadline, "%H:%M").strftime("%I:%M %p") + " IST"
    except Exception:
        deadline_display = f"{deadline} IST"

    return {
        "enabled": is_attendance_reminder_enabled(db),
        "deadline_time": deadline_display,
        "official_email": get_official_communication_email(db),
        "last_sent_date": get_attendance_reminder_last_sent(db)
    }

@router.post("/reminder/toggle")
def toggle_reminder(request: ReminderToggleRequest, db: DbSession, current_user: CurrentEmployee):
    """Enable or disable attendance reminder. Super Admin only."""
    if current_user.role != RoleEnum.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admin can toggle reminder"
        )
    set_attendance_reminder(db, request.enabled, current_user.id)
    return {"message": f"Attendance reminder {'enabled' if request.enabled else 'disabled'}"}


@router.post("/reminder/send-now")
def send_reminder_now(db: DbSession, current_user: CurrentEmployee):
    """Force send attendance reminder emails immediately. Super Admin only."""
    if current_user.role != RoleEnum.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admin can send reminders"
        )
    return process_attendance_reminders(db, force=True)

@router.get("/reminder/pending")
def get_pending_attendance(db: DbSession, current_user: CurrentEmployee):
    """Get list of employees who haven't marked attendance today. Super Admin only."""
    if current_user.role != RoleEnum.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admin can view pending attendance"
        )
    pending = get_employees_without_attendance_today(db)
    return [{"id": s.id, "name": f"{s.first_name} {s.last_name}", "employee_id": s.employee_id} for s in pending]


# Attendance Report Endpoints
class MonthReportRequest(BaseModel):
    year: int
    month: int

@router.post("/reports/non-compliant")
def get_non_compliant_report(request: MonthReportRequest, db: DbSession, current_user: CurrentEmployee):
    """Get attendance exception records for a month. HR and Admin only."""
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to view reports"
        )
    
    start_date = date(request.year, request.month, 1)
    if request.month == 12:
        end_date = date(request.year + 1, 1, 1) - timedelta(days=1)
    else:
        end_date = date(request.year, request.month + 1, 1) - timedelta(days=1)
    
    return get_non_compliant_attendance(db, start_date, end_date)

@router.post("/reports/non-compliant/aggregated")
def get_monthly_aggregated(request: MonthReportRequest, db: DbSession, current_user: CurrentEmployee):
    """Get aggregated monthly attendance (Present, Leave, Absent) per Employee. HR/Admin only."""
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    from app.services.attendance import get_monthly_aggregated_report
    return get_monthly_aggregated_report(db, request.year, request.month)

@router.post("/reports/non-compliant/summary")
def get_non_compliant_summary_report(request: MonthReportRequest, db: DbSession, current_user: CurrentEmployee):
    """Get summary statistics for attendance exceptions. HR and Admin only."""
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to view reports"
        )
    
    start_date = date(request.year, request.month, 1)
    if request.month == 12:
        end_date = date(request.year + 1, 1, 1) - timedelta(days=1)
    else:
        end_date = date(request.year, request.month + 1, 1) - timedelta(days=1)
    
    return get_non_compliant_summary(db, start_date, end_date)

@router.post("/reports/non-compliant/export")
def export_non_compliant_excel(request: MonthReportRequest, db: DbSession, current_user: CurrentEmployee):
    """Export the attendance report as Excel with Summary and Detailed sheets."""
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to export reports"
        )
    
    start_date = date(request.year, request.month, 1)
    if request.month == 12:
        end_date = date(request.year + 1, 1, 1) - timedelta(days=1)
    else:
        end_date = date(request.year, request.month + 1, 1) - timedelta(days=1)
    
    excel_content = generate_non_compliant_excel(db, start_date, end_date)
    filename = f"attendance_non_compliant_{request.year}_{request.month}.xlsx"
    
    return Response(
        content=excel_content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

# Employee Location Management Endpoints
class EmployeeLocationRequest(BaseModel):
    employee_id: str
    department_id: str
    location_name: Optional[str] = None
    location_lat: float
    location_lng: float
    is_primary: bool = False

@router.post("/locations/assign")
def assign_employee_location(request: EmployeeLocationRequest, db: DbSession, current_user: CurrentEmployee):
    """Assign a location to a employee. HR and Admin only."""
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to assign locations")
    
    from app.models.employee_location import EmployeeLocation
    
    new_location = EmployeeLocation(
        employee_id=request.employee_id,
        department_id=request.department_id,
        location_name=request.location_name,
        location_lat=request.location_lat,
        location_lng=request.location_lng,
        is_primary=request.is_primary
    )
    db.add(new_location)
    db.commit()
    db.refresh(new_location)
    return {"message": "Location assigned successfully", "id": new_location.id}

@router.get("/locations/employee/{employee_id}")
def get_employee_locations(employee_id: str, db: DbSession, current_user: CurrentEmployee):
    """Get all locations assigned to a employee."""
    from app.models.employee_location import EmployeeLocation
    
    locations = db.query(EmployeeLocation).filter(
        EmployeeLocation.employee_id == employee_id,
        EmployeeLocation.is_active == True
    ).all()
    
    return [{
        "id": loc.id,
        "department_id": loc.department_id,
        "location_name": loc.location_name,
        "location_lat": loc.location_lat,
        "location_lng": loc.location_lng,
        "is_primary": loc.is_primary
    } for loc in locations]

@router.delete("/locations/{location_id}")
def remove_employee_location(location_id: str, db: DbSession, current_user: CurrentEmployee):
    """Remove a location assignment from a employee. HR and Admin only."""
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to remove locations")
    
    from app.models.employee_location import EmployeeLocation
    
    location = db.query(EmployeeLocation).filter(EmployeeLocation.id == location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    
    location.is_active = False
    db.commit()
    return {"message": "Location removed successfully"}
