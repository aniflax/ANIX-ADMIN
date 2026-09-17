from datetime import timedelta

import pytest
from fastapi import HTTPException

from app.core.security import create_access_token
from app.models.employee import AccountEvent, RoleEnum, EmployeeStatusEnum
from app.schemas.employee import EmployeeAdminUpdate
from app.services.auth import authenticate_employee, verify_email_with_token
from app.services.employee import admin_update_employee


def test_authenticate_employee_blocks_unverified_email(db_session, make_employee):
    employee = make_employee(
        employee_id=10006,
        email="employee@example.com",
        email_verified=False,
    )

    with pytest.raises(HTTPException) as exc:
        authenticate_employee(db_session, employee_id=10006, password="secret123")

    assert exc.value.status_code == 403
    assert "Email address is not verified" in exc.value.detail
    db_session.refresh(employee)
    assert employee.status == EmployeeStatusEnum.ACTIVE


def test_authenticate_employee_accepts_email_case_insensitively(db_session, make_employee):
    make_employee(
        employee_id=10006,
        email="employee@example.com",
        email_verified=True,
        password="secret123",
    )

    employee = authenticate_employee(
        db_session,
        identifier="KTEJAKRISHNA@GMAIL.COM",
        password="secret123",
    )

    assert employee.email == "employee@example.com"


def test_verify_email_with_token_marks_user_verified(db_session, make_employee):
    employee = make_employee(email_verified=False)
    token = create_access_token(
        data={"sub": employee.id, "purpose": "verify_email"},
        expires_delta=timedelta(minutes=30),
    )

    assert verify_email_with_token(db_session, employee.id, token) is True

    db_session.refresh(employee)
    assert employee.email_verified is True

    event_types = [row.event_type for row in db_session.query(AccountEvent).all()]
    assert "EMAIL_VERIFIED" in event_types


def test_admin_update_resets_email_verification_and_requests_new_mail(
    db_session,
    make_employee,
    monkeypatch,
):
    admin = make_employee(
        employee_id=10001,
        email="admin@example.com",
        role=RoleEnum.SUPER_ADMIN,
        email_verified=True,
    )
    target = make_employee(
        employee_id=10007,
        email="old@example.com",
        email_verified=True,
    )

    calls = []
    monkeypatch.setattr(
        "app.services.employee.send_email_verification_email",
        lambda **kwargs: calls.append(kwargs) or True,
    )

    updated = admin_update_employee(
        db_session,
        target,
        EmployeeAdminUpdate(email="new@example.com"),
        admin,
    )

    db_session.refresh(updated)
    assert updated.email == "new@example.com"
    assert updated.email_verified is False
    assert calls, "verification email should be re-requested after email change"
