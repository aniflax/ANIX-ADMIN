"""Bulk communication: resolve recipients and dispatch email to each."""
from __future__ import annotations

import logging
from typing import Iterable, List, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.sevak import RoleEnum, Sevak, SevakStatusEnum
from app.services.notifications import send_bulk_communication_email

logger = logging.getLogger(__name__)

BULK_MODES = {"all", "department", "role", "custom"}


def _base_query(db: Session):
    return db.query(Sevak).filter(
        Sevak.is_active.is_(True),
        Sevak.status == SevakStatusEnum.ACTIVE,
        Sevak.email.isnot(None),
        Sevak.email != "",
        Sevak.email_verified.is_(True),
    )


def resolve_bulk_recipients(
    db: Session,
    *,
    mode: str,
    department_id: Optional[str] = None,
    roles: Optional[List[str]] = None,
    include_ids: Optional[List[str]] = None,
    exclude_ids: Optional[List[str]] = None,
) -> List[Sevak]:
    """Resolve recipient accounts for a bulk communication.

    Semantics (Custom mode):
      base = all active sevaks (SEVAK + HOD) with verified email
      if include_ids is non-empty: restrict to those sevaks
      always subtract exclude_ids

    For other modes the candidate set is the union of the selected
    department/role filters intersected with the base pool.
    """
    if mode not in BULK_MODES:
        raise HTTPException(status_code=400, detail="Invalid selection mode.")

    base = _base_query(db)

    if mode == "all":
        candidates = base.all()
    elif mode == "department":
        if not department_id:
            raise HTTPException(status_code=400, detail="department_id is required for 'department' mode.")
        candidates = base.filter(Sevak.department_id == department_id).all()
    elif mode == "role":
        if not roles:
            raise HTTPException(status_code=400, detail="At least one role is required for 'role' mode.")
        try:
            role_enums = [RoleEnum(r) for r in roles]
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid role value: {exc}") from exc
        candidates = base.filter(Sevak.role.in_(role_enums)).all()
    elif mode == "custom":
        candidates = base.all()
    else:
        candidates = []

    include_set = set(include_ids or [])
    exclude_set = set(exclude_ids or [])

    resolved: List[Sevak] = []
    for sevak in candidates:
        if include_set and sevak.id not in include_set:
            continue
        if sevak.id in exclude_set:
            continue
        resolved.append(sevak)

    return resolved


def send_bulk_communication(
    db: Session,
    *,
    actor: Sevak,
    mode: str,
    subject: str,
    body: str,
    department_id: Optional[str] = None,
    roles: Optional[List[str]] = None,
    include_ids: Optional[List[str]] = None,
    exclude_ids: Optional[List[str]] = None,
) -> dict:
    """Resolve recipients and email each. Returns a delivery summary."""
    if not (body or "").strip():
        raise HTTPException(status_code=400, detail="Message body is required.")

    recipients = resolve_bulk_recipients(
        db,
        mode=mode,
        department_id=department_id,
        roles=roles,
        include_ids=include_ids,
        exclude_ids=exclude_ids,
    )

    sender_name = f"{actor.first_name} {actor.last_name}".strip() or "anix HRMS"
    sent = 0
    failed = 0
    skipped_no_email = 0
    delivered_emails: List[str] = []

    for recipient in recipients:
        if not recipient.email:
            skipped_no_email += 1
            continue
        ok = send_bulk_communication_email(
            db,
            recipient=recipient,
            subject=subject,
            body=body,
            sender_name=sender_name,
        )
        if ok:
            sent += 1
            delivered_emails.append(recipient.email)
        else:
            failed += 1

    logger.info(
        "Bulk communication by %s mode=%s total=%d sent=%d failed=%d skipped=%d",
        actor.sevak_id, mode, len(recipients), sent, failed, skipped_no_email,
    )

    return {
        "total": len(recipients),
        "sent": sent,
        "failed": failed,
        "skipped_no_email": skipped_no_email,
        "subject": (subject or "").strip() or "Communication from anix HRMS",
        "delivered_emails": delivered_emails,
    }
