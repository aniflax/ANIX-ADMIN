from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Optional
from app.core.dependencies import DbSession, CurrentEmployee
from app.models.department import SystemConfig, ConfigAccessLevel
from app.models.employee import RoleEnum
from app.services.notifications import send_test_email, get_official_communication_email
from pydantic import BaseModel

router = APIRouter(prefix="/api/config", tags=["System Configuration"])

class ConfigItem(BaseModel):
    key: str
    value: str
    description: Optional[str] = None

class ConfigUpdate(BaseModel):
    key: str
    value: str


class MailConfigUpdate(BaseModel):
    official_email: str
    smtp_server: str
    smtp_port: int
    smtp_user: str
    smtp_password: Optional[str] = None
    from_name: str = "anix HRMS"
    from_email: str = "no-reply@anix-hrms.example"
    password_reset_link_validity_minutes: int = 10


class MailTestRequest(BaseModel):
    recipient_email: str
    subject: str = "anix HRMS Mail Test"
    body: Optional[str] = None


def _upsert_config(db, key: str, value: str, description: str, access_level: ConfigAccessLevel):
    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    if config:
        config.value = value
        config.description = description
        config.access_level = access_level
    else:
        config = SystemConfig(
            key=key,
            value=value,
            description=description,
            access_level=access_level,
        )
        db.add(config)
    return config

@router.get("/")
def get_configs(db: DbSession, current_user: CurrentEmployee):
    """Get all system configurations. HR, Admin, SuperAdmin only."""
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to view system configurations"
        )
    configs = db.query(SystemConfig).all()
    return [{
        "key": c.key,
        "value": "********" if c.key == "SMTP_PASSWORD" and c.value else c.value,
        "description": c.description,
        "access_level": c.access_level.value if getattr(c.access_level, "value", None) else c.access_level,
    } for c in configs if c.key != "SMTP_PASSWORD"]

@router.get("/mail")
def get_mail_config(db: DbSession, current_user: CurrentEmployee):
    """Get mail settings for Super Admin."""
    if current_user.role != RoleEnum.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to view mail settings"
        )

    keys = [
        "OFFICIAL_COMMUNICATION_EMAIL",
        "SMTP_SERVER",
        "SMTP_PORT",
        "SMTP_USER",
        "EMAILS_FROM_NAME",
        "EMAILS_FROM_EMAIL",
        "PASSWORD_RESET_LINK_VALIDITY_MINUTES",
    ]
    configs = {
        c.key: c.value
        for c in db.query(SystemConfig).filter(SystemConfig.key.in_(keys + ["SMTP_PASSWORD"])).all()
    }

    return {
        "official_email": configs.get("OFFICIAL_COMMUNICATION_EMAIL", "no-reply@anix-hrms.example"),
        "smtp_server": configs.get("SMTP_SERVER", "smtp.gmail.com"),
        "smtp_port": int(configs.get("SMTP_PORT", "587") or 587),
        "smtp_user": configs.get("SMTP_USER", ""),
        "smtp_password_set": bool(configs.get("SMTP_PASSWORD")),
        "from_name": configs.get("EMAILS_FROM_NAME", "anix HRMS"),
        "from_email": configs.get("EMAILS_FROM_EMAIL", "no-reply@anix-hrms.example"),
        "password_reset_link_validity_minutes": int(
            configs.get("PASSWORD_RESET_LINK_VALIDITY_MINUTES", "10") or 10
        ),
    }


@router.put("/mail")
def update_mail_config(request: MailConfigUpdate, db: DbSession, current_user: CurrentEmployee):
    """Update mail settings for Super Admin."""
    if current_user.role != RoleEnum.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update mail settings"
        )

    _upsert_config(db, "OFFICIAL_COMMUNICATION_EMAIL", request.official_email, "Official mailbox used for HRMS emails", ConfigAccessLevel.SUPER_ADMIN)
    _upsert_config(db, "SMTP_SERVER", request.smtp_server, "SMTP host used for outbound HRMS mail", ConfigAccessLevel.SUPER_ADMIN)
    _upsert_config(db, "SMTP_PORT", str(request.smtp_port), "SMTP port used for outbound HRMS mail", ConfigAccessLevel.SUPER_ADMIN)
    _upsert_config(db, "SMTP_USER", request.smtp_user, "SMTP username used for outbound HRMS mail", ConfigAccessLevel.SUPER_ADMIN)
    _upsert_config(db, "EMAILS_FROM_NAME", request.from_name, "Display name used on outbound HRMS mail", ConfigAccessLevel.SUPER_ADMIN)
    _upsert_config(db, "EMAILS_FROM_EMAIL", request.from_email, "From address used on outbound HRMS mail", ConfigAccessLevel.SUPER_ADMIN)
    _upsert_config(
        db,
        "PASSWORD_RESET_LINK_VALIDITY_MINUTES",
        str(request.password_reset_link_validity_minutes),
        "Validity window for password reset links in minutes",
        ConfigAccessLevel.SUPER_ADMIN,
    )
    if request.smtp_password:
        _upsert_config(db, "SMTP_PASSWORD", request.smtp_password, "SMTP password used for outbound HRMS mail", ConfigAccessLevel.SUPER_ADMIN)

    db.commit()
    return {"message": "Mail settings updated successfully"}


@router.post("/mail/test")
def test_mail_config(request: MailTestRequest, db: DbSession, current_user: CurrentEmployee):
    """Send a test email using the configured outbound mail settings."""
    if current_user.role != RoleEnum.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to test mail settings"
        )

    if not request.recipient_email or "@" not in request.recipient_email:
        raise HTTPException(status_code=400, detail="Valid recipient email is required")

    sent = send_test_email(
        email_to=request.recipient_email,
        subject=request.subject,
        body=request.body,
        db=db,
    )

    if not sent:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Test email could not be sent. Check SMTP configuration."
        )

    return {
        "message": f"Test email sent to {request.recipient_email} successfully",
        "sender": get_official_communication_email(db),
    }


@router.get("/{key}")
def get_config_by_key(key: str, db: DbSession, current_user: CurrentEmployee):
    """Get a specific configuration by key. HR, Admin, SuperAdmin only."""
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to view system configurations"
        )
    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    if not config:
        raise HTTPException(status_code=404, detail="Configuration not found")
    return {
        "key": config.key,
        "value": "********" if key == "SMTP_PASSWORD" and config.value else config.value,
        "description": config.description,
        "access_level": config.access_level.value if getattr(config.access_level, "value", None) else config.access_level,
    }


@router.put("/update")
def update_config(request: ConfigUpdate, db: DbSession, current_user: CurrentEmployee):
    """Update a system configuration. HR, Admin, SuperAdmin only."""
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update system configurations"
        )
    
    config = db.query(SystemConfig).filter(SystemConfig.key == request.key).first()
    if not config:
        raise HTTPException(status_code=404, detail="Configuration not found")
    
    # Check access level
    if config.access_level == ConfigAccessLevel.SUPER_ADMIN and current_user.role != RoleEnum.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admin can modify this configuration"
        )
    
    config.value = request.value
    config.modified_by = current_user.id
    db.commit()
    db.refresh(config)
    return {"message": f"Configuration {request.key} updated to {request.value}"}
