from datetime import datetime

import pytest
from fastapi import HTTPException

from app.models.leave import LeaveBalance, LeaveType
from app.models.employee import RoleEnum
from app.schemas.leave import LeaveRequestCreate, LeaveTypeCreate
from app.services.leave import (
    WEEK_OFF_TYPE_NAME,
    apply_for_leave,
    create_leave_type,
    get_leave_balances,
    get_leave_types,
    get_week_off_status,
    delete_leave_type,
)


def test_week_off_is_created_internally_and_hidden_from_leave_types(db_session, make_employee):
    employee = make_employee(
        employee_id=10011,
        role=RoleEnum.EMPLOYEE,
        activated_at=datetime(2026, 1, 1, 9, 0),
    )

    status = get_week_off_status(db_session, employee.id)

    week_off_type = db_session.query(LeaveType).filter(LeaveType.name == WEEK_OFF_TYPE_NAME).one()
    assert status["week_off_type_id"] == week_off_type.id
    assert WEEK_OFF_TYPE_NAME not in [leave_type.name for leave_type in get_leave_types(db_session)]


def test_week_off_is_not_returned_in_leave_balances(db_session, make_employee):
    employee = make_employee(
        employee_id=10011,
        role=RoleEnum.EMPLOYEE,
        activated_at=datetime(2026, 1, 1, 9, 0),
    )
    db_session.add(
        LeaveType(
            name="Casual Leave",
            annual_quota=12,
            max_consecutive_days=3,
            is_active=True,
        )
    )
    get_week_off_status(db_session, employee.id)

    balances = get_leave_balances(db_session, employee.id, 2026)

    leave_type_names = {
        db_session.query(LeaveType).filter(LeaveType.id == balance.leave_type_id).one().name
        for balance in balances
    }
    assert leave_type_names == {"Casual Leave"}


def test_inactive_leave_type_is_not_returned_in_leave_balances(db_session, make_employee):
    employee = make_employee(
        employee_id=10011,
        role=RoleEnum.EMPLOYEE,
        activated_at=datetime(2026, 1, 1, 9, 0),
    )
    active_type = LeaveType(name="Casual Leave", annual_quota=12, is_active=True)
    inactive_type = LeaveType(name="Deleted Leave", annual_quota=6, is_active=False)
    db_session.add_all([active_type, inactive_type])
    db_session.commit()
    db_session.refresh(active_type)
    db_session.refresh(inactive_type)
    db_session.add(
        LeaveBalance(
            employee_id=employee.id,
            leave_type_id=inactive_type.id,
            year=2026,
            total_allocated=6,
            used=0,
            pending=0,
        )
    )
    db_session.commit()

    balances = get_leave_balances(db_session, employee.id, 2026)

    assert {balance.leave_type_id for balance in balances} == {active_type.id}


def test_delete_leave_type_soft_deletes_and_removes_balance_cards(db_session, make_employee):
    super_admin = make_employee(
        employee_id=10000,
        role=RoleEnum.SUPER_ADMIN,
        email="super@example.com",
        password="ChangeMe@123",
    )
    employee = make_employee(
        employee_id=10011,
        role=RoleEnum.EMPLOYEE,
        email="employee@example.com",
        activated_at=datetime(2026, 1, 1, 9, 0),
    )
    leave_type = LeaveType(name="Floating Leave", annual_quota=3, is_active=True)
    db_session.add(leave_type)
    db_session.commit()
    db_session.refresh(leave_type)
    db_session.add(
        LeaveBalance(
            employee_id=employee.id,
            leave_type_id=leave_type.id,
            year=2026,
            total_allocated=3,
            used=0,
            pending=0,
        )
    )
    db_session.commit()

    delete_leave_type(db_session, leave_type.id, "ChangeMe@123", super_admin)

    db_session.refresh(leave_type)
    assert leave_type.is_active is False
    assert db_session.query(LeaveBalance).filter(LeaveBalance.leave_type_id == leave_type.id).count() == 0


def test_create_leave_type_reactivates_deleted_type_with_same_name(db_session, make_employee):
    super_admin = make_employee(
        employee_id=10000,
        role=RoleEnum.SUPER_ADMIN,
        email="super@example.com",
        password="ChangeMe@123",
    )
    leave_type = LeaveType(name="Sick Leave", annual_quota=6, max_consecutive_days=3, is_active=True)
    db_session.add(leave_type)
    db_session.commit()
    db_session.refresh(leave_type)

    delete_leave_type(db_session, leave_type.id, "ChangeMe@123", super_admin)

    restored = create_leave_type(
        db_session,
        LeaveTypeCreate(
            name="Sick Leave",
            annual_quota=12,
            max_consecutive_days=5,
            description="Updated sick leave",
        ),
        super_admin,
    )

    assert restored.id == leave_type.id
    assert restored.is_active is True
    assert restored.annual_quota == 12
    assert restored.max_consecutive_days == 5


def test_privileged_roles_cannot_apply_for_self_leave(db_session, make_employee):
    admin = make_employee(
        employee_id=10000,
        role=RoleEnum.ADMIN,
        activated_at=datetime(2026, 1, 1, 9, 0),
    )
    leave_type = LeaveType(
        name="Casual Leave",
        annual_quota=12,
        max_consecutive_days=3,
        is_active=True,
    )
    db_session.add(leave_type)
    db_session.commit()
    db_session.refresh(leave_type)

    with pytest.raises(HTTPException) as exc:
        apply_for_leave(
            db_session,
            LeaveRequestCreate(
                leave_type_id=leave_type.id,
                start_date=datetime(2026, 5, 14).date(),
                end_date=datetime(2026, 5, 14).date(),
                reason="Self leave",
            ),
            admin,
        )

    assert exc.value.status_code == 403


def test_regular_leave_excludes_default_week_off_from_total_days(db_session, make_employee, make_leave_type):
    employee = make_employee(
        employee_id=10011,
        role=RoleEnum.EMPLOYEE,
        default_week_off="Sunday",
        activated_at=datetime(2026, 1, 1, 9, 0),
    )
    leave_type = make_leave_type(annual_quota=12)

    leave_request = apply_for_leave(
        db_session,
        LeaveRequestCreate(
            leave_type_id=leave_type.id,
            start_date=datetime(2026, 5, 14).date(),
            end_date=datetime(2026, 5, 18).date(),
            reason="Family visit",
        ),
        employee,
    )

    balance = db_session.query(LeaveBalance).filter(
        LeaveBalance.employee_id == employee.id,
        LeaveBalance.leave_type_id == leave_type.id,
        LeaveBalance.year == 2026,
    ).one()
    assert leave_request.total_days == 4
    assert balance.pending == 4


def test_regular_leave_rejects_range_containing_only_week_off(db_session, make_employee, make_leave_type):
    employee = make_employee(
        employee_id=10011,
        role=RoleEnum.EMPLOYEE,
        default_week_off="Sunday",
        activated_at=datetime(2026, 1, 1, 9, 0),
    )
    leave_type = make_leave_type(annual_quota=12)

    with pytest.raises(HTTPException) as exc:
        apply_for_leave(
            db_session,
            LeaveRequestCreate(
                leave_type_id=leave_type.id,
                start_date=datetime(2026, 5, 17).date(),
                end_date=datetime(2026, 5, 17).date(),
                reason="Week off only",
            ),
            employee,
        )

    assert exc.value.status_code == 400
    assert "only week-off days" in exc.value.detail
