from pydantic_settings import BaseSettings
from pydantic import field_validator
from functools import lru_cache
import os

class Settings(BaseSettings):
    DATABASE_URL: str = os.environ.get("DATABASE_URL")
    SECRET_KEY: str = os.environ.get("SECRET_KEY")

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def _normalize_database_url(cls, v):
        # Render (and Heroku) provision managed Postgres with a legacy
        # `postgres://` scheme. SQLAlchemy 2.0 only knows `postgresql://`
        # and will raise NoSuchModuleError("sqlalchemy.dialects:postgres")
        # when given the legacy scheme. Rewrite the scheme in-place so
        # the same code works on Render, Heroku, and local (`postgresql://`)
        # without changes to the deployment env vars.
        if isinstance(v, str) and v.startswith("postgres://"):
            return "postgresql://" + v[len("postgres://"):]
        return v
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    GCS_BUCKET_NAME: str = ""
    ENVIRONMENT: str = "development"

    # SMTP Settings
    SMTP_SERVER: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    EMAILS_FROM_NAME: str = "anix HRMS"
    EMAILS_FROM_EMAIL: str = "no-reply@anix-hrms.example"
    EMAIL_PROVIDER: str = "smtp"
    BREVO_API_KEY: str = ""
    FRONTEND_URL: str = "http://localhost:5173"

    # Storage settings. Use STORAGE_PROVIDER=local only for local development.
    STORAGE_PROVIDER: str = os.environ.get("STORAGE_PROVIDER")
    R2_ACCOUNT_ID: str = os.environ.get("R2_ACCOUNT_ID")
    R2_ACCESS_KEY_ID: str = os.environ.get("R2_ACCESS_KEY")
    R2_SECRET_ACCESS_KEY: str = os.environ.get("R2_SECRET_ACCESS_KEY")
    R2_BUCKET_NAME: str = os.environ.get("R2_BUCKET_NAME")
    R2_ENDPOINT_URL: str = os.environ.get("R2_ENDPOINT_URL")

    # Database pool settings. Keep small on free hosts.
    DB_POOL_SIZE: int = 2
    DB_MAX_OVERFLOW: int = 3

    # Server settings (optional, for uvicorn config reference)
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    RELOAD: bool = False

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

@lru_cache()
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
