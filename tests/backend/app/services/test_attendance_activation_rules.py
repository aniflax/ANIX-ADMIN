from datetime import date, datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.models.attendance import AttendanceLog, AttendanceSource, AttendanceStatus
from app.models.department_location import DepartmentLocation
from app.models.location import Location
from app.models.employee import RoleEnum
from app.models.employee_location import EmployeeLocation
from app.schemas.attendance import AttendanceManualUpdate, AttendanceMarkRequest
from app.schemas.leave import LeaveRequestCreate
from app.services import attendance as attendance_service
from app.services import leave as leave_service


def test_mark_attendance_rejects_before_activation_date(db_session, make_employee, monkeypatch):
    employee = make_employee(activated_at=datetime(2026, 5, 5, 9, 0))
    monkeypatch.setattr(attendance_service, "get_local_now", lambda: datetime(2026, 5, 4, 10, 0))

    with pytest.raises(HTTPException) as exc:
        attendance_service.mark_attendance(
            db=db_session,
            request=AttendanceMarkRequest(lat=17.3850, lng=78.4867, source=AttendanceSource.WEB),
            current_user=employee,
        )

    assert exc.value.status_code == 400
    assert "activation date" in exc.value.detail


def test_mark_attendance_allows_activation_date(db_session, make_employee, monkeypatch):
    employee = make_employee(activated_at=datetime(2026, 5, 5, 9, 0))
    monkeypatch.setattr(attendance_service, "get_local_now", lambda: datetime(2026, 5, 5, 10, 0))

    log = attendance_service.mark_attendance(
        db=db_session,
        request=AttendanceMarkRequest(lat=17.3850, lng=78.4867, source=AttendanceSource.WEB),
        current_user=employee,
    )

    assert log.date == date(2026, 5, 5)
    assert log.status == AttendanceStatus.PRESENT
    assert log.location_lat == 17.3850
    assert log.location_lng == 78.4867

    serialized = attendance_service.serialize_attendance_log(db_session, log, employee)
    assert serialized["location_name"] is None
    assert serialized["location_status"] == "Captured"
    assert "17.385" in serialized["location_map_url"]


def test_attendance_location_capture_survives_missing_optional_location_tables(db_session, make_department, make_employee, monkeypatch):
    department = make_department()
    employee = make_employee(
        department_id=department.id,
        activated_at=datetime(2026, 5, 5, 9, 0),
    )
    db_session.execute(text("DROP TABLE employee_locations"))
    db_session.execute(text("DROP TABLE department_locations"))
    db_session.execute(text("DROP TABLE locations"))
    db_session.commit()
    monkeypatch.setattr(attendance_service, "get_local_now", lambda: datetime(2026, 5, 5, 10, 0))

    log = attendance_service.mark_attendance(
        db=db_session,
        request=AttendanceMarkRequest(lat=17.3850, lng=78.4867, source=AttendanceSource.WEB),
        current_user=employee,
    )
    serialized = attendance_service.serialize_attendance_log(db_session, log, employee)

    assert log.location_lat == 17.3850
    assert log.location_lng == 78.4867
    assert log.geo_flagged is False
    assert serialized["location_name"] is None
    assert serialized["location_status"] == "Captured"
    assert serialized["location_map_url"] == "https://www.google.com/maps?q=17.385,78.4867"


def test_mark_attendance_rejects_without_location(db_session, make_employee, monkeypatch):
    employee = make_employee(activated_at=datetime(2026, 5, 5, 9, 0))
    monkeypatch.setattr(attendance_service, "get_local_now", lambda: datetime(2026, 5, 5, 10, 0))

    with pytest.raises(HTTPException) as exc:
        attendance_service.mark_attendance(
            db=db_session,
            request=AttendanceMarkRequest(source=AttendanceSource.WEB),
            current_user=employee,
        )

    assert exc.value.status_code == 400
    assert "Location permission" in exc.value.detail


def test_mark_attendance_duplicate_request_is_rejected(db_session, make_employee, monkeypatch):
    employee = make_employee(activated_at=datetime(2026, 5, 5, 9, 0))
    monkeypatch.setattr(attendance_service, "get_local_now", lambda: datetime(2026, 5, 5, 10, 0))

    attendance_service.mark_attendance(
        db=db_session,
        request=AttendanceMarkRequest(lat=17.3850, lng=78.4867, source=AttendanceSource.WEB),
        current_user=employee,
    )

    with pytest.raises(HTTPException) as exc:
        attendance_service.mark_attendance(
            db=db_session,
            request=AttendanceMarkRequest(lat=17.3850, lng=78.4867, source=AttendanceSource.WEB),
            current_user=employee,
        )

    assert exc.value.status_code == 400
    assert "already marked" in exc.value.detail


def test_mark_attendance_geo_flags_outside_allocated_employee_location(db_session, make_department, make_employee, monkeypatch):
    department = make_department()
    employee = make_employee(
        employee_id=10007,
        email="outside-allocated@example.com",
        department_id=department.id,
        activated_at=datetime(2026, 5, 5, 9, 0),
    )
    db_session.add(EmployeeLocation(
        employee_id=employee.id,
        department_id=department.id,
        location_name="Main Office",
        location_lat=17.3850,
        location_lng=78.4867,
    ))
    db_session.commit()
    monkeypatch.setattr(attendance_service, "get_local_now", lambda: datetime(2026, 5, 5, 10, 0))

    log = attendance_service.mark_attendance(
        db=db_session,
        request=AttendanceMarkRequest(lat=17.4500, lng=78.5500, source=AttendanceSource.WEB),
        current_user=employee,
    )

    serialized = attendance_service.serialize_attendance_log(db_session, log, employee)
    assert log.geo_flagged is True
    assert log.location_lat == 17.4500
    assert log.location_lng == 78.5500
    assert serialized["geo_flagged"] is True
    assert serialized["location_name"] is None
    assert serialized["location_status"] == "Mismatch"
    assert "17.45" in serialized["location_map_url"]


def test_mark_attendance_geo_flags_outside_department_office_location(db_session, make_department, make_employee, monkeypatch):
    department = make_department()
    location = Location(
        name="Department Office",
        latitude=17.3850,
        longitude=78.4867,
        geo_threshold_meters=100,
        is_active=True,
    )
    db_session.add(location)
    db_session.commit()
    db_session.add(DepartmentLocation(
        department_id=department.id,
        location_id=location.id,
        is_primary=True,
    ))
    db_session.commit()
    employee = make_employee(
        employee_id=10007,
        email="outside-department-office@example.com",
        department_id=department.id,
        activated_at=datetime(2026, 5, 5, 9, 0),
    )
    monkeypatch.setattr(attendance_service, "get_local_now", lambda: datetime(2026, 5, 5, 10, 0))

    log = attendance_service.mark_attendance(
        db=db_session,
        request=AttendanceMarkRequest(lat=17.3865, lng=78.4882, source=AttendanceSource.WEB),
        current_user=employee,
    )

    serialized = attendance_service.serialize_attendance_log(db_session, log, employee)
    assert log.geo_flagged is True
    assert serialized["geo_flagged"] is True
    assert serialized["location_name"] is None
    assert serialized["location_status"] == "Mismatch"


def test_attendance_geo_threshold_string_values_are_compared_as_numbers(db_session, make_department, make_employee, monkeypatch):
    department = make_department()
    department.location_lat = 17.3850
    department.location_lng = 78.4867
    department.geo_threshold_meters = "100"
    db_session.commit()
    employee = make_employee(
        email="string-threshold@example.com",
        department_id=department.id,
        activated_at=datetime(2026, 5, 5, 9, 0),
    )
    monkeypatch.setattr(attendance_service, "get_local_now", lambda: datetime(2026, 5, 5, 10, 0))

    log = attendance_service.mark_attendance(
        db=db_session,
        request=AttendanceMarkRequest(lat=17.3865, lng=78.4882, source=AttendanceSource.WEB),
        current_user=employee,
    )
    serialized = attendance_service.serialize_attendance_log(db_session, log, employee)

    assert serialized["geo_flagged"] is True
    assert serialized["location_name"] is None
    assert serialized["location_status"] == "Mismatch"


def test_manual_attendance_update_rejects_before_activation_date(db_session, make_employee):
    admin = make_employee(employee_id=10007, email="admin@example.com")
    employee = make_employee(employee_id=10008, email="employee@example.com", activated_at=datetime(2026, 5, 5, 9, 0))

    with pytest.raises(HTTPException) as exc:
        attendance_service.manual_update_attendance(
            db=db_session,
            request=AttendanceManualUpdate(
                employee_id=employee.id,
                date=date(2026, 5, 4),
                status=AttendanceStatus.PRESENT,
                source=AttendanceSource.MANUAL,
            ),
            current_user=admin,
        )

    assert exc.value.status_code == 400
    assert "activation date" in exc.value.detail


def test_pending_attendance_starts_only_from_activation_date(db_session, make_employee, monkeypatch):
    today = date(2026, 5, 4)
    active_today = make_employee(employee_id=10007, email="active.today@example.com", activated_at=datetime(2026, 5, 4, 9, 0))
    future_activation = make_employee(employee_id=10008, email="future@example.com", activated_at=datetime(2026, 5, 5, 9, 0))
    no_activation = make_employee(employee_id=10009, email="no.activation@example.com", activated_at=None)
    monkeypatch.setattr(attendance_service, "get_local_today", lambda: today)

    pending = attendance_service.get_employees_without_attendance_today(db_session)
    pending_ids = {item.id for item in pending}

    assert active_today.id in pending_ids
    assert future_activation.id not in pending_ids
    assert no_activation.id not in pending_ids


def test_pending_attendance_excludes_admin_hr_and_superadmin_accounts(db_session, make_employee, monkeypatch):
    today = date(2026, 5, 4)
    employee = make_employee(employee_id=10011, email="employee@example.com", role=RoleEnum.EMPLOYEE, activated_at=datetime(2026, 5, 4, 9, 0))
    hod = make_employee(employee_id=10012, email="hod@example.com", role=RoleEnum.HOD, activated_at=datetime(2026, 5, 4, 9, 0))
    admin = make_employee(employee_id=10001, email="admin@example.com", role=RoleEnum.ADMIN, activated_at=datetime(2026, 5, 4, 9, 0))
    hr = make_employee(employee_id=10002, email="hr@example.com", role=RoleEnum.HR, activated_at=datetime(2026, 5, 4, 9, 0))
    super_admin = make_employee(employee_id=10000, email="super@example.com", role=RoleEnum.SUPER_ADMIN, activated_at=datetime(2026, 5, 4, 9, 0))
    monkeypatch.setattr(attendance_service, "get_local_today", lambda: today)

    pending_ids = {item.id for item in attendance_service.get_employees_without_attendance_today(db_session)}

    assert pending_ids == {employee.id, hod.id}
    assert admin.id not in pending_ids
    assert hr.id not in pending_ids
    assert super_admin.id not in pending_ids


def test_monthly_attendance_report_excludes_admin_hr_and_superadmin_accounts(db_session, make_employee):
    employee = make_employee(employee_id=10011, email="employee@example.com", role=RoleEnum.EMPLOYEE, activated_at=datetime(2026, 5, 1, 9, 0))
    hod = make_employee(employee_id=10012, email="hod@example.com", role=RoleEnum.HOD, activated_at=datetime(2026, 5, 1, 9, 0))
    make_employee(employee_id=10001, email="admin@example.com", role=RoleEnum.ADMIN, activated_at=datetime(2026, 5, 1, 9, 0))
    make_employee(employee_id=10002, email="hr@example.com", role=RoleEnum.HR, activated_at=datetime(2026, 5, 1, 9, 0))
    make_employee(employee_id=10000, email="super@example.com", role=RoleEnum.SUPER_ADMIN, activated_at=datetime(2026, 5, 1, 9, 0))

    report = attendance_service.get_monthly_aggregated_report(db_session, 2026, 5)
    report_ids = {row["employee_db_id"] for row in report}

    assert report_ids == {employee.id, hod.id}


def test_attendance_report_summary_matches_monthly_aggregate_rows(db_session, make_employee):
    employee = make_employee(
        employee_id=10011,
        email="employee@example.com",
        role=RoleEnum.EMPLOYEE,
        activated_at=datetime(2026, 5, 1, 9, 0),
        default_week_off="Sunday",
    )
    hod = make_employee(
        employee_id=10012,
        email="hod@example.com",
        role=RoleEnum.HOD,
        activated_at=datetime(2026, 5, 1, 9, 0),
        default_week_off="Sunday",
    )
    db_session.add_all([
        AttendanceLog(
            employee_id=employee.id,
            date=date(2026, 5, 1),
            check_in_time=datetime(2026, 5, 1, 9, 0),
            status=AttendanceStatus.PRESENT,
            source=AttendanceSource.WEB,
            geo_flagged=False,
        ),
        AttendanceLog(
            employee_id=employee.id,
            date=date(2026, 5, 2),
            check_in_time=datetime(2026, 5, 2, 9, 0),
            status=AttendanceStatus.PRESENT,
            source=AttendanceSource.WEB,
            geo_flagged=True,
        ),
        AttendanceLog(
            employee_id=hod.id,
            date=date(2026, 5, 1),
            check_in_time=datetime(2026, 5, 1, 9, 0),
            status=AttendanceStatus.PRESENT,
            source=AttendanceSource.WEB,
            geo_flagged=True,
        ),
    ])
    db_session.commit()

    rows = attendance_service.get_monthly_aggregated_report(db_session, 2026, 5)
    summary = attendance_service.get_non_compliant_summary(
        db_session,
        date(2026, 5, 1),
        date(2026, 5, 31),
    )

    missed_attendance = sum(row["absent_days"] for row in rows)
    geo_mismatch = sum(row["geo_mismatch"] for row in rows)

    assert summary["missed_attendance"] == missed_attendance
    assert summary["geo_mismatch"] == geo_mismatch
    assert summary["total_records"] == missed_attendance + geo_mismatch
    assert summary["unique_employees"] == sum(
        1 for row in rows if row["absent_days"] > 0 or row["geo_mismatch"] > 0
    )


def test_monthly_attendance_report_recalculates_geo_mismatch_from_saved_coordinates(
    db_session,
    make_department,
    make_employee,
):
    department = make_department()
    location = Location(
        name="Department Office",
        latitude=17.3850,
        longitude=78.4867,
        geo_threshold_meters=100,
        is_active=True,
    )
    db_session.add(location)
    db_session.commit()
    db_session.add(DepartmentLocation(
        department_id=department.id,
        location_id=location.id,
        is_primary=True,
    ))
    employee = make_employee(
        employee_id=10007,
        email="report-geo@example.com",
        role=RoleEnum.EMPLOYEE,
        department_id=department.id,
        activated_at=datetime(2026, 5, 1, 9, 0),
        default_week_off="Sunday",
    )
    db_session.add(AttendanceLog(
        employee_id=employee.id,
        date=date(2026, 5, 2),
        check_in_time=datetime(2026, 5, 2, 9, 0),
        status=AttendanceStatus.PRESENT,
        source=AttendanceSource.WEB,
        location_lat=17.4500,
        location_lng=78.5500,
        geo_flagged=False,
    ))
    db_session.commit()

    rows = attendance_service.get_monthly_aggregated_report(db_session, 2026, 5)
    employee_row = next(row for row in rows if row["employee_id"] == 10007)

    assert employee_row["geo_mismatch"] == 1
    assert employee_row["present"] == 0


def test_apply_leave_rejects_before_activation_date(db_session, make_employee, make_leave_type):
    employee = make_employee(activated_at=datetime(2026, 5, 5, 9, 0))
    leave_type = make_leave_type(annual_quota=12)

    with pytest.raises(HTTPException) as exc:
        leave_service.apply_for_leave(
            db=db_session,
            request_data=LeaveRequestCreate(
                leave_type_id=leave_type.id,
                start_date=date(2026, 5, 4),
                end_date=date(2026, 5, 4),
                reason="Before activation",
            ),
            current_user=employee,
        )

    assert exc.value.status_code == 400
    assert "activation date" in exc.value.detail
