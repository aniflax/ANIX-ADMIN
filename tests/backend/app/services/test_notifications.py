from datetime import date, datetime, timedelta
from types import SimpleNamespace

from app.models.attendance import AttendanceLog, AttendanceSource, AttendanceStatus
from app.models.department import ConfigAccessLevel, SystemConfig
from app.models.leave import LeaveRequest, LeaveRequestStatus, LeaveType
from app.models.employee import EmployeeStatusEnum
from app.services import attendance as attendance_service
from app.services.notifications import (
    _send_message,
    _build_message,
    create_password_reset_notification,
    process_attendance_reminders,
    send_account_activation_email,
    send_test_email,
)


def test_password_reset_uses_configured_validity_window(db_session, make_config, make_employee, monkeypatch):
    make_config(
        key="PASSWORD_RESET_LINK_VALIDITY_MINUTES",
        value="15",
        description="Password reset link validity",
        access_level=ConfigAccessLevel.SUPER_ADMIN,
    )
    employee = make_employee(email="employee@example.com", email_verified=True)

    captured = {}

    def fake_create_access_token(*, data, expires_delta=None):
        captured["purpose"] = data["purpose"]
        captured["expires_delta"] = expires_delta
        return "token-123"

    monkeypatch.setattr("app.services.notifications.create_access_token", fake_create_access_token)
    monkeypatch.setattr("app.services.notifications.send_password_reset_email", lambda **kwargs: True)

    assert create_password_reset_notification(db_session, employee) is True
    assert captured["purpose"] == "reset_password"
    assert captured["expires_delta"] == timedelta(minutes=15)

    reset_request = db_session.query(SystemConfig).filter(SystemConfig.key == "PASSWORD_RESET_LINK_VALIDITY_MINUTES").first()
    assert reset_request.value == "15"


def test_process_attendance_reminders_includes_locked_but_active_users(db_session, make_employee, monkeypatch):
    locked = make_employee(
        employee_id=10006,
        email="employee@example.com",
        email_verified=True,
        status=EmployeeStatusEnum.LOCKED,
    )
    active = make_employee(
        employee_id=10007,
        email="present@example.com",
        email_verified=True,
    )
    inactive = make_employee(
        employee_id=10008,
        email="inactive@example.com",
        email_verified=True,
        is_active=False,
    )

    today = date(2026, 4, 21)
    db_session.add(
        AttendanceLog(
            id="att-1",
            employee_id=active.id,
            date=today,
            status=AttendanceStatus.PRESENT,
            source=AttendanceSource.WEB,
        )
    )
    db_session.commit()

    leave_type = LeaveType(
        id="leave-type-1",
        name="Casual Leave",
        description="Test leave type",
        is_active=True,
    )
    db_session.add(leave_type)
    db_session.commit()
    db_session.add(
        LeaveRequest(
            id="leave-1",
            employee_id=inactive.id,
            leave_type_id=leave_type.id,
            start_date=today,
            end_date=today,
            total_days=1,
            reason="Sick",
            status=LeaveRequestStatus.APPROVED,
        )
    )
    db_session.commit()

    monkeypatch.setattr(attendance_service, "get_local_today", lambda: today)
    pending = attendance_service.get_employees_without_attendance_today(db_session)
    pending_ids = {item.id for item in pending}
    assert locked.id in pending_ids
    assert active.id not in pending_ids
    assert inactive.id not in pending_ids

    class FakeResult:
        def scalar(self):
            return True

    monkeypatch.setattr(db_session, "execute", lambda *args, **kwargs: FakeResult())
    monkeypatch.setattr(attendance_service, "is_attendance_reminder_enabled", lambda db: True)
    monkeypatch.setattr(attendance_service, "get_attendance_deadline", lambda db: "10:30")
    monkeypatch.setattr(attendance_service, "get_local_today", lambda: today)
    monkeypatch.setattr(attendance_service, "get_local_now", lambda: datetime(2026, 4, 21, 11, 0))
    monkeypatch.setattr(attendance_service, "get_employees_without_attendance_today", lambda db: [locked])
    monkeypatch.setattr("app.services.notifications.send_attendance_reminder_email", lambda *args, **kwargs: True)
    monkeypatch.setattr("app.services.notifications.mark_attendance_reminder_sent", lambda *args, **kwargs: None)

    result = process_attendance_reminders(db_session, force=True)
    assert result["status"] == "completed"
    assert result["sent"] == 1
    assert result["skipped"] == 0
    assert result["failed"] == 0
    assert result["reminder_date"] == today.isoformat()


def test_send_test_email_requires_configuration(monkeypatch):
    monkeypatch.setattr("app.services.notifications.get_email_provider", lambda db: "smtp")
    monkeypatch.setattr("app.services.notifications.get_smtp_user", lambda db: "")
    monkeypatch.setattr("app.services.notifications.get_smtp_password", lambda db: "")
    assert send_test_email("recipient@example.com", db=None) is False


def test_send_message_uses_brevo_api_when_configured(monkeypatch):
    captured = {}

    class FakeResponse:
        text = ""

        def raise_for_status(self):
            return None

    def fake_post(url, headers, json, timeout):
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr("app.services.notifications.get_email_provider", lambda db: "brevo")
    monkeypatch.setattr("app.services.notifications.get_brevo_api_key", lambda db: "brevo-key")
    monkeypatch.setattr("app.services.notifications.httpx.post", fake_post)

    message = _build_message(
        to_email="recipient@example.com",
        subject="Activation Test",
        body="Plain body",
        html_body="<p>HTML body</p>",
        from_email="sender@example.com",
        from_name="anix HRMS",
        reply_to="reply@example.com",
    )

    assert _send_message(message, db=None) is True
    assert captured["url"] == "https://api.brevo.com/v3/smtp/email"
    assert captured["headers"]["api-key"] == "brevo-key"
    assert captured["json"] == {
        "sender": {"name": "anix HRMS", "email": "sender@example.com"},
        "to": [{"email": "recipient@example.com"}],
        "subject": "Activation Test",
        "textContent": "Plain body",
        "htmlContent": "<p>HTML body</p>",
        "replyTo": {"email": "reply@example.com"},
    }


def test_send_message_returns_false_when_brevo_key_missing(monkeypatch):
    monkeypatch.setattr("app.services.notifications.get_email_provider", lambda db: "brevo")
    monkeypatch.setattr("app.services.notifications.get_brevo_api_key", lambda db: "")

    message = _build_message(
        to_email="recipient@example.com",
        subject="Activation Test",
        body="Plain body",
        from_email="sender@example.com",
        from_name="anix HRMS",
    )

    assert _send_message(message, db=None) is False


def test_activation_email_contains_mobile_accessible_full_link(db_session, make_employee, monkeypatch):
    employee = make_employee(email="mobile@example.com", email_verified=False)
    captured = {}

    monkeypatch.setattr("app.services.notifications.create_access_token", lambda **kwargs: "activation-token")
    monkeypatch.setattr("app.services.notifications.settings.FRONTEND_URL", "http://192.168.1.10:5173/")
    def capture_message(message, db=None):
        captured["message"] = message
        return True

    monkeypatch.setattr("app.services.notifications._send_message", capture_message)

    assert send_account_activation_email(db_session, employee, requested_by_name="Test") is True

    message = captured["message"]
    expected_link = f"http://192.168.1.10:5173/activate-account?token=activation-token&id={employee.id}"
    assert expected_link in message.get_payload(0).get_payload()
    assert expected_link in message.get_payload(1).get_payload()
    assert "Activate Account" in message.get_payload(1).get_payload()


def test_activation_email_prefers_request_frontend_url(db_session, make_employee, monkeypatch):
    employee = make_employee(email="phone-origin@example.com", email_verified=False)
    captured = {}

    monkeypatch.setattr("app.services.notifications.create_access_token", lambda **kwargs: "activation-token")
    monkeypatch.setattr("app.services.notifications.settings.FRONTEND_URL", "http://localhost:5173")

    def capture_message(message, db=None):
        captured["message"] = message
        return True

    monkeypatch.setattr("app.services.notifications._send_message", capture_message)

    assert send_account_activation_email(
        db_session,
        employee,
        requested_by_name="Mobile Onboarding",
        frontend_url="http://192.168.1.10:5173",
    ) is True

    message = captured["message"]
    expected_link = f"http://192.168.1.10:5173/activate-account?token=activation-token&id={employee.id}"
    assert expected_link in message.get_payload(0).get_payload()
    assert "http://localhost:5173/activate-account" not in message.get_payload(0).get_payload()


def test_activation_email_rewrites_localhost_to_lan_for_mobile(db_session, make_employee, monkeypatch):
    employee = make_employee(email="lan-fallback@example.com", email_verified=False)
    captured = {}

    monkeypatch.setattr("app.services.notifications.create_access_token", lambda **kwargs: "activation-token")
    monkeypatch.setattr("app.services.notifications.settings.FRONTEND_URL", "http://localhost:5173")
    monkeypatch.setattr("app.services.notifications._get_lan_ip", lambda: "192.168.1.25")

    def capture_message(message, db=None):
        captured["message"] = message
        return True

    monkeypatch.setattr("app.services.notifications._send_message", capture_message)

    assert send_account_activation_email(db_session, employee, requested_by_name="Desktop Resend") is True

    expected_link = f"http://192.168.1.25:5173/activate-account?token=activation-token&id={employee.id}"
    assert expected_link in captured["message"].get_payload(0).get_payload()
