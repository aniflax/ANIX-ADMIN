from app.models.department import ConfigAccessLevel
from app.models.sevak import RoleEnum


def test_attendance_reminder_status_and_force_send(api_client_factory, make_sevak, make_config, monkeypatch):
    super_admin = make_sevak(
        sevak_id=10000,
        email="superadmin@anix.local",
        email_verified=True,
        role=RoleEnum.SUPER_ADMIN,
    )
    make_config(
        key="ATTENDANCE_REMINDER_ENABLED",
        value="true",
        description="Toggle reminders",
        access_level=ConfigAccessLevel.SUPER_ADMIN,
    )
    make_config(
        key="ATTENDANCE_DEADLINE_TIME",
        value="10:30",
        description="Reminder deadline",
        access_level=ConfigAccessLevel.SUPER_ADMIN,
    )
    make_config(
        key="OFFICIAL_COMMUNICATION_EMAIL",
        value="no-reply@anix-hrms.example",
        description="Official mailbox",
        access_level=ConfigAccessLevel.SUPER_ADMIN,
    )
    make_config(
        key="ATTENDANCE_REMINDER_LAST_SENT_DATE",
        value="2026-04-20",
        description="Last reminder date",
        access_level=ConfigAccessLevel.SUPER_ADMIN,
    )

    client = api_client_factory(super_admin)

    status_response = client.get("/api/attendance/reminder/status")
    assert status_response.status_code == 200
    assert status_response.json()["enabled"] is True
    assert status_response.json()["deadline_time"] == "10:30 AM IST"
    assert status_response.json()["official_email"] == "no-reply@anix-hrms.example"
    assert status_response.json()["last_sent_date"] == "2026-04-20"

    monkeypatch.setattr(
        "app.api.attendance.process_attendance_reminders",
        lambda db, force=False: {"sent": 2, "skipped": 1, "failed": 0, "status": "completed", "reminder_date": "2026-04-21"},
    )
    send_now_response = client.post("/api/attendance/reminder/send-now")
    assert send_now_response.status_code == 200
    assert send_now_response.json()["sent"] == 2
    assert send_now_response.json()["status"] == "completed"
