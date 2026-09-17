from app.models.employee import RoleEnum
from app.core.security import create_access_token


def _verify_email_for_account_creation(client, email):
    otp_response = client.post(
        "/api/employees/admin/accounts/otp/send",
        json={"email": email},
    )
    assert otp_response.status_code == 200
    otp_body = otp_response.json()
    assert "debug_otp" not in otp_body

    verify_response = client.post(
        "/api/employees/admin/accounts/otp/verify",
        json={
            "email": email.upper(),
            "otp": "123456",
            "otp_token": otp_body["otp_token"],
        },
    )
    assert verify_response.status_code == 200
    return verify_response.json()["email_verification_token"]


def test_superadmin_create_admin_account_endpoint(api_client_factory, db_session, make_employee, monkeypatch):
    super_admin = make_employee(employee_id=10000, email="super@example.com", role=RoleEnum.SUPER_ADMIN)
    monkeypatch.setattr("app.services.employee.send_account_activation_email", lambda **kwargs: True)
    monkeypatch.setattr("app.services.employee.send_admin_account_otp_email", lambda **kwargs: True)
    monkeypatch.setattr("app.services.employee.secrets.randbelow", lambda _limit: 123456)

    client = api_client_factory(super_admin)
    verification_token = _verify_email_for_account_creation(client, "admin@example.com")

    response = client.post(
        "/api/employees/admin/accounts",
        json={
            "account_id": 10001,
            "role": "ADMIN",
            "first_name": "Admin",
            "last_name": "User",
            "phone": "9999999999",
            "email": "ADMIN@example.com",
            "email_verification_token": verification_token,
            "send_invitation": True,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["account"]["employee_id"] == 10001
    assert body["account"]["email"] == "admin@example.com"
    assert body["account"]["role"] == "ADMIN"
    assert body["account"]["status"] == "INACTIVE"
    assert body["temporary_password"]
    assert body["invitation_sent"] is True


def test_admin_cannot_create_admin_or_hr_account_endpoint(api_client_factory, make_employee):
    admin = make_employee(employee_id=10001, email="admin@example.com", role=RoleEnum.ADMIN)

    client = api_client_factory(admin)
    response = client.post(
        "/api/employees/admin/accounts",
        json={
            "role": "HR",
            "first_name": "HR",
            "last_name": "User",
            "email": "hr@example.com",
        },
    )

    assert response.status_code == 403


def test_account_create_requires_verified_email_token(api_client_factory, make_employee):
    super_admin = make_employee(employee_id=10000, email="super@example.com", role=RoleEnum.SUPER_ADMIN)

    client = api_client_factory(super_admin)
    response = client.post(
        "/api/employees/admin/accounts",
        json={
            "role": "HR",
            "first_name": "HR",
            "last_name": "User",
            "email": "hr@example.com",
            "email_verification_token": "not-a-valid-token",
        },
    )

    assert response.status_code == 400


def test_created_admin_account_activates_and_logs_in_with_generated_credentials(
    api_client_factory,
    db_session,
    make_employee,
    monkeypatch,
):
    super_admin = make_employee(employee_id=10000, email="super@example.com", role=RoleEnum.SUPER_ADMIN)
    monkeypatch.setattr("app.services.employee.send_account_activation_email", lambda **kwargs: True)
    monkeypatch.setattr("app.services.employee.send_admin_account_otp_email", lambda **kwargs: True)
    monkeypatch.setattr("app.services.employee.secrets.randbelow", lambda _limit: 123456)

    client = api_client_factory(super_admin)
    verification_token = _verify_email_for_account_creation(client, "hr@example.com")
    create_response = client.post(
        "/api/employees/admin/accounts",
        json={
            "role": "HR",
            "first_name": "HR",
            "last_name": "User",
            "phone": "9999999999",
            "email": "hr@example.com",
            "email_verification_token": verification_token,
            "send_invitation": True,
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    account = created["account"]

    activation_token = create_access_token(data={"sub": account["id"], "purpose": "activate_account"})
    activation_response = client.post(
        "/api/auth/activate-account",
        json={"employee_id": account["id"], "token": activation_token},
    )
    assert activation_response.status_code == 200

    login_response = client.post(
        "/api/auth/login",
        json={"identifier": str(account["employee_id"]), "password": created["temporary_password"]},
    )
    assert login_response.status_code == 200
    assert login_response.json()["role"] == "HR"
