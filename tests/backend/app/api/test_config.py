from app.models.department import ConfigAccessLevel, SystemConfig
from app.models.employee import RoleEnum


def test_mail_config_round_trip_and_test_email(api_client_factory, db_session, make_employee, make_config, monkeypatch):
    super_admin = make_employee(
        employee_id=10000,
        email="superadmin@anix.local",
        email_verified=True,
        role=RoleEnum.SUPER_ADMIN,
    )
    make_config(
        key="OFFICIAL_COMMUNICATION_EMAIL",
        value="no-reply@anix-hrms.example",
        description="Official mailbox",
        access_level=ConfigAccessLevel.SUPER_ADMIN,
    )
    make_config(
        key="SMTP_SERVER",
        value="smtp.gmail.com",
        description="SMTP server",
        access_level=ConfigAccessLevel.SUPER_ADMIN,
    )
    make_config(
        key="SMTP_PORT",
        value="587",
        description="SMTP port",
        access_level=ConfigAccessLevel.SUPER_ADMIN,
    )
    make_config(
        key="SMTP_USER",
        value="no-reply@anix-hrms.example",
        description="SMTP user",
        access_level=ConfigAccessLevel.SUPER_ADMIN,
    )
    make_config(
        key="EMAILS_FROM_NAME",
        value="anix HRMS",
        description="Sender name",
        access_level=ConfigAccessLevel.SUPER_ADMIN,
    )
    make_config(
        key="EMAILS_FROM_EMAIL",
        value="no-reply@anix-hrms.example",
        description="Sender email",
        access_level=ConfigAccessLevel.SUPER_ADMIN,
    )
    make_config(
        key="PASSWORD_RESET_LINK_VALIDITY_MINUTES",
        value="10",
        description="Password reset validity",
        access_level=ConfigAccessLevel.SUPER_ADMIN,
    )
    make_config(
        key="SMTP_PASSWORD",
        value="app-password",
        description="SMTP app password",
        access_level=ConfigAccessLevel.SUPER_ADMIN,
    )

    client = api_client_factory(super_admin)
    response = client.get("/api/config/mail")
    assert response.status_code == 200
    payload = response.json()
    assert payload["official_email"] == "no-reply@anix-hrms.example"
    assert payload["password_reset_link_validity_minutes"] == 10
    assert payload["smtp_password_set"] is True

    update_response = client.put(
        "/api/config/mail",
        json={
            "official_email": "no-reply@anix-hrms.example",
            "smtp_server": "smtp.gmail.com",
            "smtp_port": 587,
            "smtp_user": "no-reply@anix-hrms.example",
            "smtp_password": "new-app-password",
            "from_name": "anix HRMS",
            "from_email": "no-reply@anix-hrms.example",
            "password_reset_link_validity_minutes": 12,
        },
    )
    assert update_response.status_code == 200

    refreshed = client.get("/api/config/mail").json()
    assert refreshed["password_reset_link_validity_minutes"] == 12
    assert refreshed["smtp_password_set"] is True

    monkeypatch.setattr("app.api.config.send_test_email", lambda **kwargs: True)
    test_response = client.post(
        "/api/config/mail/test",
        json={"recipient_email": "employee@example.com", "subject": "Smoke test"},
    )
    assert test_response.status_code == 200
    assert test_response.json()["sender"] == "no-reply@anix-hrms.example"


def test_config_list_hides_mail_transport_password(api_client_factory, make_employee, make_config):
    super_admin = make_employee(
        employee_id=10000,
        email="superadmin@anix.local",
        email_verified=True,
        role=RoleEnum.SUPER_ADMIN,
    )
    make_config(
        key="SMTP_PASSWORD",
        value="app-password",
        description="SMTP app password",
        access_level=ConfigAccessLevel.SUPER_ADMIN,
    )

    client = api_client_factory(super_admin)
    response = client.get("/api/config/")
    assert response.status_code == 200
    keys = {item["key"] for item in response.json()}
    assert "SMTP_PASSWORD" not in keys
