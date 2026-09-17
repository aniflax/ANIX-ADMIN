import logging
import socket
import smtplib
import threading
import time
from datetime import date, datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional
from urllib.parse import urlparse, urlunparse

import httpx
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import create_access_token
from app.models.department import ConfigAccessLevel, SystemConfig
from app.models.sevak import AccountEvent, Sevak

logger = logging.getLogger(__name__)

_reminder_worker_started = False


def _get_config_value(db: Session | None, key: str, default: Optional[str] = None) -> Optional[str]:
    if db is None:
        return default

    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    if config and config.value is not None:
        return config.value
    return default


def _upsert_config_value(
    db: Session,
    key: str,
    value: str,
    description: str,
    access_level: ConfigAccessLevel = ConfigAccessLevel.SUPER_ADMIN,
    modified_by: Optional[str] = None,
) -> None:
    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    if config:
        config.value = value
        config.description = description
        config.access_level = access_level
        config.modified_by = modified_by
    else:
        db.add(
            SystemConfig(
                key=key,
                value=value,
                description=description,
                access_level=access_level,
                modified_by=modified_by,
            )
        )
    db.commit()


def get_official_communication_email(db: Session | None = None) -> str:
    return (
        _get_config_value(db, "OFFICIAL_COMMUNICATION_EMAIL")
        or _get_config_value(db, "EMAILS_FROM_EMAIL")
        or _get_config_value(db, "SMTP_USER")
        or "no-reply@anix-hrms.example"
    )


def get_attendance_deadline_time(db: Session | None = None) -> str:
    return _get_config_value(db, "ATTENDANCE_DEADLINE_TIME", "10:30") or "10:30"


def get_password_reset_link_validity_minutes(db: Session | None = None) -> int:
    raw_value = _get_config_value(db, "PASSWORD_RESET_LINK_VALIDITY_MINUTES", "10") or "10"
    try:
        return max(1, int(raw_value))
    except Exception:
        return 10


def get_smtp_server(db: Session | None = None) -> str:
    return _get_config_value(db, "SMTP_SERVER", "smtp.gmail.com") or "smtp.gmail.com"


def get_smtp_port(db: Session | None = None) -> int:
    raw_port = _get_config_value(db, "SMTP_PORT", "587") or "587"
    try:
        return int(raw_port)
    except Exception:
        return 587


def get_smtp_user(db: Session | None = None) -> str:
    return _get_config_value(db, "SMTP_USER", "") or ""


def get_smtp_password(db: Session | None = None) -> str:
    return _get_config_value(db, "SMTP_PASSWORD", "") or ""


def get_email_provider(db: Session | None = None) -> str:
    return (_get_config_value(db, "EMAIL_PROVIDER", settings.EMAIL_PROVIDER) or "smtp").strip().lower()


def get_brevo_api_key(db: Session | None = None) -> str:
    return _get_config_value(db, "BREVO_API_KEY", settings.BREVO_API_KEY) or ""


def get_email_from_name(db: Session | None = None) -> str:
    return _get_config_value(db, "EMAILS_FROM_NAME", "anix HRMS") or "anix HRMS"


def get_email_from_email(db: Session | None = None) -> str:
    return _get_config_value(db, "EMAILS_FROM_EMAIL", "no-reply@anix-hrms.example") or "no-reply@anix-hrms.example"


def _get_lan_ip() -> Optional[str]:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            ip_address = sock.getsockname()[0]
            if ip_address and not ip_address.startswith("127."):
                return ip_address
    except OSError:
        return None
    return None


def get_mobile_accessible_frontend_url(frontend_url: str) -> str:
    parsed = urlparse(frontend_url)
    if parsed.hostname not in {"localhost", "127.0.0.1", "0.0.0.0"}:
        return frontend_url.rstrip("/")

    lan_ip = _get_lan_ip()
    if not lan_ip:
        return frontend_url.rstrip("/")

    netloc = lan_ip
    if parsed.port:
        netloc = f"{lan_ip}:{parsed.port}"
    return urlunparse((parsed.scheme or "http", netloc, parsed.path.rstrip("/"), "", "", "")).rstrip("/")


def get_attendance_reminder_last_sent(db: Session | None = None) -> Optional[str]:
    return _get_config_value(db, "ATTENDANCE_REMINDER_LAST_SENT_DATE")


def mark_attendance_reminder_sent(db: Session, sent_date: date) -> None:
    _upsert_config_value(
        db=db,
        key="ATTENDANCE_REMINDER_LAST_SENT_DATE",
        value=sent_date.isoformat(),
        description="Internal scheduler marker for the last attendance reminder run",
        access_level=ConfigAccessLevel.SUPER_ADMIN,
    )


def _build_message(
    *,
    to_email: str,
    subject: str,
    body: str,
    html_body: Optional[str] = None,
    reply_to: Optional[str] = None,
    from_email: Optional[str] = None,
    from_name: Optional[str] = None,
) -> MIMEMultipart:
    message = MIMEMultipart("alternative")
    sender_email = from_email or get_official_communication_email()
    sender_name = from_name or get_email_from_name()

    message["From"] = f"{sender_name} <{sender_email}>"
    message["To"] = to_email
    message["Subject"] = subject
    if reply_to:
        message["Reply-To"] = reply_to
    message.attach(MIMEText(body, "plain"))
    if html_body:
        message.attach(MIMEText(html_body, "html"))
    return message


def _extract_message_body(message: MIMEMultipart) -> tuple[str, Optional[str]]:
    text_body = ""
    html_body = None

    for part in message.get_payload():
        content_type = part.get_content_type()
        payload = part.get_payload(decode=True)
        charset = part.get_content_charset() or "utf-8"
        body = payload.decode(charset, errors="replace") if payload else part.get_payload()

        if content_type == "text/plain":
            text_body = body
        elif content_type == "text/html":
            html_body = body

    return text_body, html_body


def _parse_sender(message: MIMEMultipart) -> tuple[str, str]:
    from email.utils import parseaddr

    name, email = parseaddr(message["From"])
    return name or get_email_from_name(), email or get_email_from_email()


def _send_brevo_message(message: MIMEMultipart, db: Session | None = None) -> bool:
    api_key = get_brevo_api_key(db)
    if not api_key:
        logger.warning("Brevo API key is not configured. Email was not sent.")
        return False

    text_body, html_body = _extract_message_body(message)
    sender_name, sender_email = _parse_sender(message)

    payload = {
        "sender": {"name": sender_name, "email": sender_email},
        "to": [{"email": message["To"]}],
        "subject": message["Subject"],
        "textContent": text_body,
    }
    if html_body:
        payload["htmlContent"] = html_body
    if message.get("Reply-To"):
        payload["replyTo"] = {"email": message["Reply-To"]}

    try:
        response = httpx.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={
                "accept": "application/json",
                "api-key": api_key,
                "content-type": "application/json",
            },
            json=payload,
            timeout=20,
        )
        response.raise_for_status()
        return True
    except httpx.HTTPStatusError as exc:
        logger.error("Brevo email API rejected message: %s", exc.response.text)
        return False
    except Exception as exc:
        logger.error("Brevo email API request failed: %s", exc)
        return False


def _send_smtp_message(message: MIMEMultipart, db: Session | None = None) -> bool:
    smtp_user = get_smtp_user(db)
    smtp_password = get_smtp_password(db)
    smtp_server = get_smtp_server(db)
    smtp_port = get_smtp_port(db)

    if not smtp_user or not smtp_password:
        log_line = (
            f"--- EMAIL SENT ---\n"
            f"To: {message['To']}\n"
            f"From: {message['From']}\n"
            f"Subject: {message['Subject']}\n"
            f"Content: {message.get_payload(0).get_payload()}\n"
            f"------------------\n"
        )
        if settings.ENVIRONMENT.lower() == "development":
            with open("mail_logs.txt", "a", encoding="utf-8") as f:
                f.write(log_line)
            logger.warning("SMTP credentials not set. Email preview logged to mail_logs.txt instead.")
            return False

        logger.warning("SMTP credentials not set. Email was not sent.")
        return False

    try:
        with smtplib.SMTP(smtp_server, smtp_port) as server:
            server.starttls()
            server.login(smtp_user, smtp_password)
            server.send_message(message)
        return True
    except Exception as exc:
        logger.error("Failed to send email: %s", exc)
        return False


def _send_message(message: MIMEMultipart, db: Session | None = None) -> bool:
    if get_email_provider(db) == "brevo":
        return _send_brevo_message(message, db=db)
    return _send_smtp_message(message, db=db)


def send_password_reset_email(
    email_to: str,
    reset_link: str,
    user_name: str,
    db: Session | None = None,
    expiry_minutes: int = 10,
) -> bool:
    subject = "Password Reset - anix HRMS"
    body = f"""Hi {user_name},

You have requested to reset your password for anix HRMS.
Please click the link below to set a new password:

{reset_link}

This link will expire in {expiry_minutes} minutes.
If you did not request this, please contact the Admin.
"""
    message = _build_message(
        to_email=email_to,
        subject=subject,
        body=body,
        reply_to=get_official_communication_email(db),
    )
    return _send_message(message, db=db)


def send_test_email(
    email_to: str,
    subject: str = "anix HRMS Mail Test",
    body: Optional[str] = None,
    db: Session | None = None,
) -> bool:
    official_email = get_official_communication_email(db)
    message = _build_message(
        to_email=email_to,
        subject=subject,
        body=body
        or f"""This is a test email from anix HRMS.

Official mailbox: {official_email}
SMTP user: {get_smtp_user(db) or 'not configured'}
SMTP server: {get_smtp_server(db)}
SMTP port: {get_smtp_port(db)}
Email provider: {get_email_provider(db)}
""",
        reply_to=official_email,
        from_email=official_email,
        from_name=get_email_from_name(db),
    )
    return _send_message(message, db=db)


def send_account_activation_email(
    db: Session,
    sevak: Sevak,
    requested_by_name: Optional[str] = None,
    frontend_url: Optional[str] = None,
) -> bool:
    if not sevak.email:
        logger.warning("Skipping activation email for sevak %s because email is not configured.", sevak.id)
        return False

    activation_token = create_access_token(
        data={"sub": sevak.id, "purpose": "activate_account"},
        expires_delta=timedelta(minutes=30),
    )
    activation_base_url = get_mobile_accessible_frontend_url(frontend_url or settings.FRONTEND_URL)
    activation_link = f"{activation_base_url}/activate-account?token={activation_token}&id={sevak.id}"

    db.add(
        AccountEvent(
            sevak_id=sevak.id,
            event_type="ACCOUNT_ACTIVATION_REQUESTED",
            resolved_by=None,
            notes=(
                f"Activation link generated by {requested_by_name}"
                if requested_by_name
                else "Activation link generated automatically"
            ),
        )
    )
    db.commit()

    role_label = str(sevak.role.value if hasattr(sevak.role, "value") else sevak.role).replace("_", " ")
    id_label = "Account ID" if role_label in {"ADMIN", "HR", "SUPER ADMIN"} else "Sevak ID"
    subject = "Activate your account - anix HRMS"
    body = f"""Hi {sevak.first_name} {sevak.last_name},

Your {role_label} account has been created in anix HRMS.
Please click the Activation Link to activate your account.

This link will expire in 30 minutes.
Your {id_label} is {sevak.sevak_id if sevak.sevak_id else 'allocated after activation'}.

Activation link:
{activation_link}
"""
    html_body = f"""<html><body>
<p>Hi {sevak.first_name} {sevak.last_name},</p>
<p>Your <strong>{role_label}</strong> account has been created in anix HRMS.</p>
<p>Please click the activation button to activate your account.</p>
<p><strong>{id_label}:</strong> {sevak.sevak_id if sevak.sevak_id else 'Allocated after activation'}</p>
<p><a href="{activation_link}" style="display:inline-block;padding:10px 16px;background:#f47c20;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:700;">Activate Account</a></p>
<p>If the button does not open on your phone, copy and paste this full link in the same browser used for anix HRMS:</p>
<p style="word-break:break-all;"><a href="{activation_link}">{activation_link}</a></p>
<p>This link will expire in 30 minutes.</p>
</body></html>"""
    message = _build_message(
        to_email=sevak.email,
        subject=subject,
        body=body,
        html_body=html_body,
        reply_to=get_official_communication_email(db),
        from_email=get_official_communication_email(db),
        from_name=get_email_from_name(db),
    )
    return _send_message(message, db=db)


def send_account_credentials_email(
    *,
    db: Session,
    sevak: Sevak,
    temporary_password: str,
    login_link: str,
    requested_by_name: Optional[str] = None,
) -> bool:
    if not sevak.email:
        logger.warning("Skipping credentials email for sevak %s because email is not configured.", sevak.id)
        return False

    role_label = str(sevak.role.value if hasattr(sevak.role, "value") else sevak.role).replace("_", " ")
    subject = "Your anix HRMS login details"
    body = f"""Hi {sevak.first_name} {sevak.last_name},

Your anix HRMS {role_label} account login details are below.

Account ID: {sevak.sevak_id}
Temporary Password: {temporary_password}
Login link: {login_link}

Please activate your account first if you have not already done so, then sign in and change your password immediately.
"""
    html_body = f"""<html><body>
<p>Hi {sevak.first_name} {sevak.last_name},</p>
<p>Your anix HRMS <strong>{role_label}</strong> account login details are below.</p>
<p><strong>Account ID:</strong> {sevak.sevak_id}</p>
<p><strong>Temporary Password:</strong> {temporary_password}</p>
<p><a href="{login_link}" style="display:inline-block;padding:10px 16px;background:#f47c20;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:700;">Open anix HRMS</a></p>
<p>Please activate your account first if you have not already done so, then sign in and change your password immediately.</p>
</body></html>"""

    db.add(
        AccountEvent(
            sevak_id=sevak.id,
            event_type="ACCOUNT_CREDENTIALS_SENT",
            notes=(
                f"Login credentials sent by {requested_by_name}"
                if requested_by_name
                else "Login credentials sent"
            ),
        )
    )
    db.commit()

    message = _build_message(
        to_email=sevak.email,
        subject=subject,
        body=body,
        html_body=html_body,
        reply_to=get_official_communication_email(db),
        from_email=get_official_communication_email(db),
        from_name=get_email_from_name(db),
    )
    return _send_message(message, db=db)


def send_admin_account_otp_email(
    *,
    db: Session,
    email_to: str,
    otp: str,
    requested_by_name: Optional[str] = None,
) -> bool:
    subject = "Verify email for anix HRMS account creation"
    body = f"""Hi,

Your OTP for creating an Admin/HR account in anix HRMS is:

{otp}

This OTP will expire in 10 minutes.
"""
    if requested_by_name:
        body += f"\nRequested by: {requested_by_name}\n"

    html_body = f"""<html><body>
<p>Hi,</p>
<p>Your OTP for creating an Admin/HR account in anix HRMS is:</p>
<p style="font-size:24px;font-weight:700;letter-spacing:4px;">{otp}</p>
<p>This OTP will expire in 10 minutes.</p>
{f'<p>Requested by: {requested_by_name}</p>' if requested_by_name else ''}
</body></html>"""
    message = _build_message(
        to_email=email_to,
        subject=subject,
        body=body,
        html_body=html_body,
        reply_to=get_official_communication_email(db),
        from_email=get_official_communication_email(db),
        from_name=get_email_from_name(db),
    )
    return _send_message(message, db=db)


def create_password_reset_notification(
    db: Session,
    sevak: Sevak,
    requested_by_id: Optional[str] = None,
    requested_by_name: Optional[str] = None,
    notes: Optional[str] = None,
) -> bool:
    if not sevak.email:
        logger.warning("Skipping reset email for sevak %s because email is not configured.", sevak.id)
        return False

    validity_minutes = get_password_reset_link_validity_minutes(db)
    reset_token = create_access_token(
        data={"sub": sevak.id, "purpose": "reset_password"},
        expires_delta=timedelta(minutes=validity_minutes),
    )
    reset_link = f"{settings.FRONTEND_URL}/reset-password?token={reset_token}&id={sevak.id}"

    # Store token issuance time to invalidate previous tokens
    sevak.password_reset_token_issued_at = get_local_now()

    db.add(
        AccountEvent(
            sevak_id=sevak.id,
            event_type="PASSWORD_RESET_REQUESTED",
            resolved_by=requested_by_id,
            notes=notes or (
                f"Reset link generated by {requested_by_name}"
                if requested_by_name
                else "Reset link generated automatically"
            ),
        )
    )
    db.commit()

    return send_password_reset_email(
        email_to=sevak.email,
        reset_link=reset_link,
        user_name=f"{sevak.first_name} {sevak.last_name}",
        db=db,
        expiry_minutes=validity_minutes,
    )


def send_attendance_reminder_email(db: Session, sevak: Sevak, reminder_date: Optional[date] = None) -> bool:
    reminder_date = reminder_date or datetime.now().date()
    deadline_time = get_attendance_deadline_time(db)
    official_email = get_official_communication_email(db)

    subject = "Attendance Reminder - anix HRMS"
    body = f"""Hi {sevak.first_name} {sevak.last_name},

This is a reminder to mark your attendance for {reminder_date.strftime('%d-%b-%Y')}.

Please mark your attendance as soon as possible.

Official communication: {official_email}
"""
    message = _build_message(
        to_email=sevak.email,
        subject=subject,
        body=body,
        reply_to=official_email,
        from_email=official_email,
        from_name=get_email_from_name(db),
    )
    return _send_message(message, db=db)


def send_leave_pending_notification_email(
    db: Session,
    *,
    recipient: Sevak,
    requester: Sevak,
    leave_type_name: str,
    start_date,
    end_date,
    total_days: float,
    reason: str,
    target_role: str,
    request_id: str,
) -> bool:
    if not recipient.email:
        logger.warning(
            "Skipping leave notification for request %s — recipient %s has no email.",
            request_id,
            recipient.id,
        )
        return False

    official_email = get_official_communication_email(db)
    base_url = get_mobile_accessible_frontend_url(settings.FRONTEND_URL)
    target_path = "/leave/approvals" if target_role == "HOD" else "/leave-admin"
    action_url = f"{base_url}{target_path}?highlight={request_id}"

    subject = f"Leave request awaiting your approval - {requester.first_name} {requester.last_name}"
    body = f"""Hi {recipient.first_name} {recipient.last_name},

A leave request from {requester.first_name} {requester.last_name} (ID #{requester.sevak_id}) is awaiting your approval.

Leave Type : {leave_type_name}
Period     : {start_date} to {end_date} ({total_days} day(s))
Reason     : {reason}

Please review and act on it here:
{action_url}

This is an automated reminder from anix HRMS.
"""
    html_body = f"""<html><body>
<p>Hi {recipient.first_name} {recipient.last_name},</p>
<p>A leave request from <strong>{requester.first_name} {requester.last_name}</strong> (ID #{requester.sevak_id}) is awaiting your approval.</p>
<table cellpadding="6" style="border-collapse:collapse;">
  <tr><td><b>Leave Type</b></td><td>{leave_type_name}</td></tr>
  <tr><td><b>Period</b></td><td>{start_date} to {end_date} ({total_days} day(s))</td></tr>
  <tr><td><b>Reason</b></td><td>{reason}</td></tr>
</table>
<p><a href="{action_url}" style="display:inline-block;padding:10px 16px;background:#f47c20;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:700;">Review Request</a></p>
<p>This is an automated reminder from anix HRMS.</p>
</body></html>"""

    message = _build_message(
        to_email=recipient.email,
        subject=subject,
        body=body,
        html_body=html_body,
        reply_to=official_email,
        from_email=official_email,
        from_name=get_email_from_name(db),
    )
    return _send_message(message, db=db)


def send_bulk_communication_email(
    db: Session,
    *,
    recipient: Sevak,
    subject: str,
    body: str,
    sender_name: str | None = None,
) -> bool:
    if not recipient.email:
        return False

    official_email = get_official_communication_email(db)
    sender_label = sender_name or "anix HRMS"

    safe_subject = (subject or "").strip() or "Communication from anix HRMS"
    safe_body = (body or "").strip()
    if not safe_body:
        return False

    text_body = f"""Hi {recipient.first_name} {recipient.last_name},

{safe_body}

---
Sent by {sender_label} via anix HRMS Bulk Communication.
If you have any questions, please reach out to the HR team.
"""
    html_body = f"""<html><body>
<p>Hi {recipient.first_name} {recipient.last_name},</p>
<div style="white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;">{safe_body}</div>
<hr style="margin-top:24px;border:none;border-top:1px solid #e0e0e0;" />
<p style="color:#777;font-size:12px;">Sent by {sender_label} via anix HRMS Bulk Communication.</p>
</body></html>"""

    message = _build_message(
        to_email=recipient.email,
        subject=safe_subject,
        body=text_body,
        html_body=html_body,
        reply_to=official_email,
        from_email=official_email,
        from_name=get_email_from_name(db),
    )
    return _send_message(message, db=db)


def process_attendance_reminders(db: Session, force: bool = False) -> dict:
    from app.services.attendance import (
        get_attendance_deadline,
        get_local_now,
        get_local_today,
        get_sevaks_without_attendance_today,
        is_attendance_reminder_enabled,
    )

    now = get_local_now()
    today = get_local_today()
    deadline_value = get_attendance_deadline(db)
    deadline_hour = 10
    deadline_minute = 30

    try:
        deadline_hour, deadline_minute = [int(part) for part in deadline_value.split(":", 1)]
    except Exception:
        deadline_hour, deadline_minute = 10, 30

    deadline = now.replace(hour=deadline_hour, minute=deadline_minute, second=0, microsecond=0)

    lock_acquired = False
    attempts = 5 if force else 1
    try:
        for _ in range(attempts):
            lock_acquired = bool(db.execute(text("SELECT pg_try_advisory_lock(hashtext('anix_attendance_reminder'))")).scalar())
            if lock_acquired:
                break
            if force:
                time.sleep(1)
    except Exception:
        logger.exception("Failed to acquire attendance reminder lock")
        return {
            "sent": 0,
            "skipped": 0,
            "failed": 0,
            "status": "lock_failed",
            "deadline_time": deadline_value,
        }

    if not lock_acquired:
        return {
            "sent": 0,
            "skipped": 0,
            "failed": 0,
            "status": "busy",
            "deadline_time": deadline_value,
        }

    try:
        if not is_attendance_reminder_enabled(db):
            return {
                "sent": 0,
                "skipped": 0,
                "failed": 0,
                "status": "disabled",
                "deadline_time": deadline_value,
            }

        if not force:
            last_sent = get_attendance_reminder_last_sent(db)
            if last_sent == today.isoformat():
                return {
                    "sent": 0,
                    "skipped": 0,
                    "failed": 0,
                    "status": "already_sent",
                    "deadline_time": deadline_value,
                }

            if now < deadline:
                return {
                    "sent": 0,
                    "skipped": 0,
                    "failed": 0,
                    "status": "pending",
                    "deadline_time": deadline_value,
                }

        pending_sevaks = get_sevaks_without_attendance_today(db)
        sent = 0
        skipped = 0
        failed = 0

        for sevak in pending_sevaks:
            if not sevak.email:
                skipped += 1
                continue

            if send_attendance_reminder_email(db, sevak, reminder_date=today):
                sent += 1
            else:
                failed += 1

        if failed == 0:
            mark_attendance_reminder_sent(db, today)

        return {
            "sent": sent,
            "skipped": skipped,
            "failed": failed,
            "status": "completed" if failed == 0 else "partial_failure",
            "deadline_time": deadline_value,
            "reminder_date": today.isoformat(),
        }
    finally:
        try:
            db.execute(text("SELECT pg_advisory_unlock(hashtext('anix_attendance_reminder'))"))
        except Exception:
            logger.exception("Failed to release attendance reminder lock")


def _attendance_reminder_worker() -> None:
    while True:
        db = SessionLocal()
        try:
            result = process_attendance_reminders(db)
            if result.get("status") == "completed" and result.get("sent"):
                logger.info(
                    "Attendance reminder sent: %s on %s",
                    result.get("sent"),
                    result.get("reminder_date"),
                )
        except Exception:
            logger.exception("Attendance reminder worker failed")
        finally:
            db.close()

        time.sleep(60)


def start_attendance_reminder_worker() -> None:
    global _reminder_worker_started
    if _reminder_worker_started:
        return

    worker = threading.Thread(target=_attendance_reminder_worker, daemon=True)
    worker.start()
    _reminder_worker_started = True
