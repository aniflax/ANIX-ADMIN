from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.employee import Employee


def normalize_email(email: str | None) -> str | None:
    if email is None:
        return None
    normalized = email.strip().lower()
    return normalized or None


def find_employee_by_email(
    db: Session,
    email: str | None,
    *,
    exclude_employee_id: str | None = None,
) -> Employee | None:
    normalized_email = normalize_email(email)
    if not normalized_email:
        return None

    query = db.query(Employee).filter(func.lower(Employee.email) == normalized_email)
    if exclude_employee_id:
        query = query.filter(Employee.id != exclude_employee_id)
    return query.first()


def ensure_email_available(
    db: Session,
    email: str | None,
    *,
    exclude_employee_id: str | None = None,
) -> str | None:
    normalized_email = normalize_email(email)
    if normalized_email and find_employee_by_email(db, normalized_email, exclude_employee_id=exclude_employee_id):
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="Email already registered")
    return normalized_email
