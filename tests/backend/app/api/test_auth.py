from datetime import timedelta

from app.core.security import create_access_token


def test_login_route_blocks_unverified_user(api_client_factory, make_employee):
    employee = make_employee(
        employee_id=10006,
        email="employee@example.com",
        email_verified=False,
    )
    client = api_client_factory(employee)

    response = client.post(
        "/api/auth/login",
        json={"employee_id": 10006, "password": "secret123"},
    )

    assert response.status_code == 403
    assert "Email address is not verified" in response.json()["detail"]


def test_verify_email_route_marks_user_verified(api_client_factory, make_employee, db_session):
    employee = make_employee(
        employee_id=10006,
        email="employee@example.com",
        email_verified=False,
    )
    token = create_access_token(
        data={"sub": employee.id, "purpose": "verify_email"},
        expires_delta=timedelta(minutes=30),
    )
    client = api_client_factory(employee)

    response = client.post(
        "/api/auth/verify-email",
        json={"employee_id": employee.id, "token": token},
    )

    assert response.status_code == 200
    assert response.json()["message"] == "Email address verified successfully."
    db_session.refresh(employee)
    assert employee.email_verified is True


def test_activate_account_allocates_real_id_for_pending_negative_placeholder(api_client_factory, make_employee, db_session):
    employee = make_employee(
        employee_id=-1,
        email="pending@example.com",
        email_verified=False,
    )
    token = create_access_token(
        data={"sub": employee.id, "purpose": "activate_account"},
        expires_delta=timedelta(minutes=30),
    )
    client = api_client_factory(employee)

    response = client.post(
        "/api/auth/activate-account",
        json={"employee_id": employee.id, "token": token},
    )

    assert response.status_code == 200
    assert response.json()["employee_id"] == 10011
    db_session.refresh(employee)
    assert employee.employee_id == 10011
    assert employee.email_verified is True
