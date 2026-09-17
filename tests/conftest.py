import os
import uuid
import sys
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Ensure the app settings module can be imported safely in tests.
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://test:test@127.0.0.1:5432/anix_test")
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("FRONTEND_URL", "http://testserver")
os.environ.setdefault("SMTP_SERVER", "smtp.gmail.com")
os.environ.setdefault("SMTP_PORT", "587")
os.environ.setdefault("SMTP_USER", "")
os.environ.setdefault("SMTP_PASSWORD", "")

sys.path.insert(0, os.path.abspath("backend"))

from app.api import attendance as attendance_api
from app.api import auth as auth_api
from app.api import config as config_api
from app.api import onboarding as onboarding_api
from app.api import sevak as sevak_api
from app.core.dependencies import get_current_sevak, get_db
from app.core.database import Base
from app.core.security import hash_password
from app.models.attendance import AttendanceLog
from app.models.department import ConfigAccessLevel, Department, SystemConfig
from app.models.leave import LeaveRequest, LeaveRequestStatus, LeaveType
from app.models.sevak import RoleEnum, Sevak, SevakStatusEnum


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def _create_sevak(
    db,
    *,
    sevak_id: int = 10006,
    first_name: str = "Test",
    last_name: str = "User",
    email: str = "test.user@example.com",
    role: RoleEnum = RoleEnum.SEVAK,
    status: SevakStatusEnum = SevakStatusEnum.ACTIVE,
    email_verified: bool = False,
    is_active: bool = True,
    default_week_off: str = "Sunday",
    password: str = "secret123",
    department_id: str | None = None,
    activated_at: datetime | None = datetime(2026, 1, 1, 9, 0),
):
    sevak = Sevak(
        id=str(uuid.uuid4()),
        sevak_id=sevak_id,
        first_name=first_name,
        last_name=last_name,
        email=email,
        email_verified=email_verified,
        hashed_password=hash_password(password),
        role=role,
        status=status,
        is_active=is_active,
        default_week_off=default_week_off,
        department_id=department_id,
        activated_at=activated_at,
    )
    db.add(sevak)
    db.commit()
    db.refresh(sevak)
    return sevak


def _create_department(db, *, name: str = "Operations"):
    department = Department(
        id=str(uuid.uuid4()),
        name=name,
        description=f"{name} department",
    )
    db.add(department)
    db.commit()
    db.refresh(department)
    return department


def _create_leave_type(db, *, name: str = "Casual Leave", annual_quota: int = 12):
    leave_type = LeaveType(
        id=str(uuid.uuid4()),
        name=name,
        description=f"{name} type",
        annual_quota=annual_quota,
        is_active=True,
    )
    db.add(leave_type)
    db.commit()
    db.refresh(leave_type)
    return leave_type


def _create_leave_request(
    db,
    *,
    sevak_id: str,
    leave_type_id: str,
    start_date,
    end_date,
    status: LeaveRequestStatus = LeaveRequestStatus.APPROVED,
    reason: str = "Test leave request",
):
    leave_request = LeaveRequest(
        id=str(uuid.uuid4()),
        sevak_id=sevak_id,
        leave_type_id=leave_type_id,
        start_date=start_date,
        end_date=end_date,
        total_days=(end_date - start_date).days + 1,
        reason=reason,
        status=status,
    )
    db.add(leave_request)
    db.commit()
    db.refresh(leave_request)
    return leave_request


def _create_attendance_log(db, *, sevak_id: str, day, status="PRESENT"):
    log = AttendanceLog(
        id=str(uuid.uuid4()),
        sevak_id=sevak_id,
        date=day,
        status=status,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def _create_config(db, *, key: str, value: str, description: str = "", access_level=ConfigAccessLevel.SUPER_ADMIN):
    config = SystemConfig(
        id=str(uuid.uuid4()),
        key=key,
        value=value,
        description=description,
        access_level=access_level,
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


@pytest.fixture()
def make_sevak(db_session):
    return lambda **kwargs: _create_sevak(db_session, **kwargs)


@pytest.fixture()
def make_department(db_session):
    return lambda **kwargs: _create_department(db_session, **kwargs)


@pytest.fixture()
def make_leave_type(db_session):
    return lambda **kwargs: _create_leave_type(db_session, **kwargs)


@pytest.fixture()
def make_leave_request(db_session):
    return lambda **kwargs: _create_leave_request(db_session, **kwargs)


@pytest.fixture()
def make_attendance_log(db_session):
    return lambda **kwargs: _create_attendance_log(db_session, **kwargs)


@pytest.fixture()
def make_config(db_session):
    return lambda **kwargs: _create_config(db_session, **kwargs)


@pytest.fixture()
def api_client_factory(db_session):
    app = FastAPI()
    app.include_router(auth_api.router)
    app.include_router(config_api.router)
    app.include_router(attendance_api.router)
    app.include_router(sevak_api.router)
    app.include_router(onboarding_api.router)

    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db

    def factory(current_user):
        app.dependency_overrides[get_current_sevak] = lambda: current_user
        return TestClient(app)

    return factory
