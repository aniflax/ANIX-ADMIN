from sqlalchemy.orm import Session
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.sevak import Sevak, RoleEnum, SevakStatusEnum
from app.models.department import SystemConfig, ConfigAccessLevel
import uuid


def seed_system_config(db: Session):
    """Insert default system config values if not present."""
    defaults = [
        {
            "key": "SEVAK_ID_START",
            "value": "10011",
            "description": "Starting number for general Sevak ID generation. 10000-10010 are reserved for SuperAdmin/Admin/HR accounts.",
            "access_level": ConfigAccessLevel.SUPER_ADMIN,
        },
        {
            "key": "SEVAK_ID_FORMAT_DIGITS",
            "value": "5",
            "description": "Number of digits in Sevak ID",
            "access_level": ConfigAccessLevel.SUPER_ADMIN,
        },
        {
            "key": "LEAVE_APPROVAL_SLA_DAYS",
            "value": "2",
            "description": "Default days for approvers to act on leave requests",
            "access_level": ConfigAccessLevel.HR,
        },
        {
            "key": "FINANCIAL_CUTOFF_DATE",
            "value": "20",
            "description": "Day of month for financial month cut-off",
            "access_level": ConfigAccessLevel.HR,
        },
        {
            "key": "GEO_THRESHOLD_METERS",
            "value": "500",
            "description": "Max distance in meters for attendance geo-validation",
            "access_level": ConfigAccessLevel.HR,
        },
        {
            "key": "OFFICIAL_COMMUNICATION_EMAIL",
            "value": "no-reply@anix-hrms.example",
            "description": "Official mailbox used for password reset and attendance reminder emails",
            "access_level": ConfigAccessLevel.SUPER_ADMIN,
        },
        {
            "key": "EMAILS_FROM_NAME",
            "value": "anix HRMS",
            "description": "Display name shown on outbound email",
            "access_level": ConfigAccessLevel.SUPER_ADMIN,
        },
        {
            "key": "EMAILS_FROM_EMAIL",
            "value": "no-reply@anix-hrms.example",
            "description": "From email shown on outbound mail",
            "access_level": ConfigAccessLevel.SUPER_ADMIN,
        },
        {
            "key": "SMTP_SERVER",
            "value": "smtp.gmail.com",
            "description": "SMTP server used for outbound mail",
            "access_level": ConfigAccessLevel.SUPER_ADMIN,
        },
        {
            "key": "SMTP_PORT",
            "value": "587",
            "description": "SMTP port used for outbound mail",
            "access_level": ConfigAccessLevel.SUPER_ADMIN,
        },
        {
            "key": "SMTP_USER",
            "value": "",
            "description": "SMTP username used for outbound mail",
            "access_level": ConfigAccessLevel.SUPER_ADMIN,
        },
        {
            "key": "SMTP_PASSWORD",
            "value": "",
            "description": "SMTP app password used for outbound mail",
            "access_level": ConfigAccessLevel.SUPER_ADMIN,
        },
        {
            "key": "ATTENDANCE_REMINDER_ENABLED",
            "value": "false",
            "description": "Enable or disable attendance reminder emails",
            "access_level": ConfigAccessLevel.SUPER_ADMIN,
        },
        {
            "key": "ATTENDANCE_DEADLINE_TIME",
            "value": "10:30",
            "description": "Attendance reminder dispatch time in 24-hour HH:MM format",
            "access_level": ConfigAccessLevel.SUPER_ADMIN,
        },
        {
            "key": "MAX_CASUAL_LEAVE_STRETCH",
            "value": "3",
            "description": "Max consecutive days allowed for casual leave",
            "access_level": ConfigAccessLevel.HR,
        },
        {
            "key": "MAX_FAILED_LOGIN_ATTEMPTS",
            "value": "3",
            "description": "Max failed login attempts before account lockout",
            "access_level": ConfigAccessLevel.ADMIN,
        },
        {
            "key": "PASSWORD_CHANGE_TENURE_DAYS",
            "value": "0",
            "description": "Days after which password change is enforced. 0 = disabled",
            "access_level": ConfigAccessLevel.ADMIN,
        },
        {
            "key": "PASSWORD_RESET_LINK_VALIDITY_MINUTES",
            "value": "10",
            "description": "Validity window for password reset links in minutes",
            "access_level": ConfigAccessLevel.SUPER_ADMIN,
        },
        {
            "key": "ANNUAL_REVIEW_START_MONTH",
            "value": "3",
            "description": "Month to initiate annual data review (3 = March)",
            "access_level": ConfigAccessLevel.ADMIN,
        },
        {
            "key": "ANNUAL_REVIEW_MANDATE_ACTIVE",
            "value": "false",
            "description": "Whether annual data review mandate popup is active",
            "access_level": ConfigAccessLevel.ADMIN,
        },
    ]

    for item in defaults:
        exists = db.query(SystemConfig).filter(
            SystemConfig.key == item["key"]
        ).first()
        if not exists:
            config = SystemConfig(
                id=str(uuid.uuid4()),
                **item
            )
            db.add(config)

    db.commit()
    print("System config seeded.")


def seed_super_admin(db: Session):
    """Create Super Admin account if not present."""
    exists = db.query(Sevak).filter(
        Sevak.role == RoleEnum.SUPER_ADMIN
    ).first()

    if not exists:
        super_admin = Sevak(
            id=str(uuid.uuid4()),
            sevak_id=10000,  # Reserved ID for Super Admin
            first_name="Aniflax",
            last_name="Admin",
            email="aniflax@aol.com",
            email_verified=True,
            hashed_password=hash_password("admin.locahost"),
            role=RoleEnum.SUPER_ADMIN,
            status=SevakStatusEnum.ACTIVE,
        )
        db.add(super_admin)
        db.commit()
        print("Super Admin created.")
        print("   Email: aniflax@aol.com")
        print("   ID: 10000")
        print("   Warning: Change this password immediately after first login!")
    else:
        print("Super Admin already exists. Skipping.")


def run_seed():
    db = SessionLocal()
    try:
        print("Seeding database...")
        seed_system_config(db)
        seed_super_admin(db)
        print("Seeding complete.")
    finally:
        db.close()


if __name__ == "__main__":
    run_seed()
