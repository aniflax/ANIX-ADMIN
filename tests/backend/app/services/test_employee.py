import pytest
from fastapi import HTTPException
from datetime import date, datetime
from sqlalchemy import text

from app.models.employee import RoleEnum, EmployeeStatusEnum
from app.services.week_off_history import get_effective_week_off_day, get_week_off_history, serialize_week_off_history
from app.schemas.employee import AdminAccountCreate, EmployeeCreate, EmployeeUpdate
from app.core.security import create_access_token
from app.services.employee import (
    ADMIN_ACCOUNT_VERIFIED_PURPOSE,
    create_privileged_account,
    create_employee,
    get_all_employees,
    get_next_employee_id,
    update_employee_profile,
)


def test_profile_email_change_resets_verification_and_requests_mail(db_session, make_employee, monkeypatch):
    employee = make_employee(
        employee_id=10006,
        email="old@example.com",
        email_verified=True,
        role=RoleEnum.EMPLOYEE,
    )

    calls = []
    monkeypatch.setattr(
        "app.services.employee.send_email_verification_email",
        lambda **kwargs: calls.append(kwargs) or True,
    )

    updated = update_employee_profile(
        db_session,
        employee,
        EmployeeUpdate(email="new@example.com"),
    )

    db_session.refresh(updated)
    assert updated.email == "new@example.com"
    assert updated.email_verified is False
    assert calls, "profile email change should trigger verification mail"


def test_week_off_forward_change_takes_effect_this_week_when_not_consumed(db_session, make_employee, monkeypatch):
    employee = make_employee(default_week_off="Sunday", activated_at=datetime(2026, 5, 1, 9, 0))
    monkeypatch.setattr("app.services.employee.get_local_today", lambda: date(2026, 5, 24))  # Sunday

    updated = update_employee_profile(db_session, employee, EmployeeUpdate(default_week_off="Saturday"))
    history = get_week_off_history(db_session, updated.id)

    assert updated.default_week_off == "Saturday"
    assert get_effective_week_off_day(db_session, updated.id, date(2026, 5, 23), "Saturday") == "Sunday"
    assert get_effective_week_off_day(db_session, updated.id, date(2026, 5, 24), "Saturday") == "Saturday"
    assert history[-1].effective_from == date(2026, 5, 24)


def test_week_off_backward_change_takes_effect_next_week(db_session, make_employee, monkeypatch):
    employee = make_employee(default_week_off="Thursday", activated_at=datetime(2026, 5, 1, 9, 0))
    monkeypatch.setattr("app.services.employee.get_local_today", lambda: date(2026, 5, 20))  # Wednesday

    updated = update_employee_profile(db_session, employee, EmployeeUpdate(default_week_off="Monday"))

    assert get_effective_week_off_day(db_session, updated.id, date(2026, 5, 21), "Monday") == "Thursday"
    assert get_effective_week_off_day(db_session, updated.id, date(2026, 5, 31), "Monday") == "Monday"


def test_week_off_change_after_current_week_off_is_consumed_takes_effect_next_week(db_session, make_employee, monkeypatch):
    employee = make_employee(default_week_off="Sunday", activated_at=datetime(2026, 5, 1, 9, 0))
    monkeypatch.setattr("app.services.employee.get_local_today", lambda: date(2026, 5, 26))  # Tuesday

    updated = update_employee_profile(db_session, employee, EmployeeUpdate(default_week_off="Saturday"))

    assert get_effective_week_off_day(db_session, updated.id, date(2026, 5, 30), "Saturday") == "Sunday"
    assert get_effective_week_off_day(db_session, updated.id, date(2026, 5, 31), "Saturday") == "Saturday"


def test_week_off_history_read_falls_back_when_table_missing(db_session, make_employee):
    employee = make_employee(default_week_off="Sunday", activated_at=datetime(2026, 5, 1, 9, 0))
    db_session.execute(text("DROP TABLE employee_week_off_history"))
    db_session.commit()

    history = serialize_week_off_history(db_session, employee)

    assert history == [{"week_off_day": "Sunday", "effective_from": date(2026, 5, 1)}]
    assert get_effective_week_off_day(db_session, employee.id, date(2026, 5, 24), "Sunday") == "Sunday"


def test_create_employee_rejects_duplicate_email_case_insensitively(db_session, make_employee, monkeypatch):
    admin = make_employee(employee_id=10000, email="admin@example.com", role=RoleEnum.SUPER_ADMIN)
    make_employee(employee_id=10007, email="duplicate@example.com")
    monkeypatch.setattr("app.services.employee.send_email_verification_email", lambda **kwargs: True)

    with pytest.raises(HTTPException) as exc:
        create_employee(
            db_session,
            EmployeeCreate(
                first_name="Dupe",
                last_name="User",
                email="DUPLICATE@EXAMPLE.COM",
                password="ChangeMe@123",
                role=RoleEnum.EMPLOYEE,
            ),
            admin,
        )

    assert exc.value.status_code == 400
    assert exc.value.detail == "Email already registered"


def test_general_employee_ids_start_after_reserved_admin_hr_range(db_session, make_employee):
    make_employee(employee_id=10000, email="super@example.com", role=RoleEnum.SUPER_ADMIN)
    make_employee(employee_id=10001, email="admin@example.com", role=RoleEnum.ADMIN)
    make_employee(employee_id=10010, email="hr@example.com", role=RoleEnum.HR)

    assert get_next_employee_id(db_session) == 10011


def test_directory_lists_only_employee_profiles(db_session, make_employee):
    super_admin = make_employee(employee_id=10000, email="super@example.com", role=RoleEnum.SUPER_ADMIN)
    admin = make_employee(employee_id=10001, email="admin@example.com", role=RoleEnum.ADMIN)
    hr = make_employee(employee_id=10002, email="hr@example.com", role=RoleEnum.HR)
    employee = make_employee(employee_id=10011, email="employee@example.com", role=RoleEnum.EMPLOYEE)
    hod = make_employee(employee_id=10012, email="hod@example.com", role=RoleEnum.HOD)

    directory_rows = get_all_employees(db_session, current_user=super_admin)
    directory_ids = {row.id for row in directory_rows}

    assert employee.id in directory_ids
    assert hod.id in directory_ids
    assert admin.id not in directory_ids
    assert hr.id not in directory_ids
    assert super_admin.id not in directory_ids


def test_superadmin_can_create_reserved_admin_account(db_session, make_employee, monkeypatch):
    super_admin = make_employee(employee_id=10000, email="super@example.com", role=RoleEnum.SUPER_ADMIN)
    sent = []
    monkeypatch.setattr(
        "app.services.employee.send_account_activation_email",
        lambda **kwargs: sent.append(kwargs) or True,
    )

    account, temporary_password, invitation_sent = create_privileged_account(
        db_session,
        AdminAccountCreate(
            account_id=10001,
            role=RoleEnum.ADMIN,
            first_name="Admin",
            last_name="User",
            phone="9999999999",
            email="admin@example.com",
            email_verification_token=create_access_token(
                data={"sub": "admin@example.com", "purpose": ADMIN_ACCOUNT_VERIFIED_PURPOSE}
            ),
            send_invitation=True,
        ),
        super_admin,
    )

    assert account.employee_id == 10001
    assert account.role == RoleEnum.ADMIN
    assert account.status == EmployeeStatusEnum.INACTIVE
    assert account.email_verified is False
    assert temporary_password
    assert invitation_sent is True
    assert sent


def test_non_superadmin_cannot_create_privileged_account(db_session, make_employee):
    admin = make_employee(employee_id=10001, email="admin@example.com", role=RoleEnum.ADMIN)

    try:
        create_privileged_account(
            db_session,
            AdminAccountCreate(
                role=RoleEnum.HR,
                first_name="HR",
                last_name="User",
                email="hr@example.com",
            ),
            admin,
        )
    except HTTPException as exc:
        assert exc.status_code == 403
    else:
        raise AssertionError("Admin should not be able to create privileged accounts")
