from fastapi import HTTPException

from app.models.sevak import Sevak
from app.services.storage import StoredObject


async def _fake_save_document_upload(file, *, sevak_id: str, doc_type: str) -> StoredObject:
    return StoredObject(
        key=f"sevaks/{sevak_id}/{doc_type}/test.pdf",
        content_type="application/pdf",
        filename=f"{doc_type}.pdf",
    )


def _registration_payload(email: str):
    data = {
        "first_name": "Test",
        "last_name": "User",
        "email": email,
        "phone": "9876543210",
        "address": "Bangalore",
        "password": "ChangeMe@123",
    }
    files = {
        "id_proof": ("id-proof.pdf", b"x" * 120_000, "application/pdf"),
        "pan_card": ("pan-card.pdf", b"x" * 120_000, "application/pdf"),
        "passbook": ("passbook.pdf", b"x" * 120_000, "application/pdf"),
    }
    return data, files


def test_multiple_pending_onboardings_receive_unique_temporary_ids(
    api_client_factory,
    db_session,
    make_sevak,
    monkeypatch,
):
    current_user = make_sevak(sevak_id=10000, email="super@example.com")
    monkeypatch.setattr("app.api.onboarding.save_document_upload", _fake_save_document_upload)
    monkeypatch.setattr("app.api.onboarding.send_account_activation_email", lambda **kwargs: True)
    client = api_client_factory(current_user)

    first_data, first_files = _registration_payload("first.pending@example.com")
    second_data, second_files = _registration_payload("second.pending@example.com")

    first_response = client.post("/api/onboarding/register", data=first_data, files=first_files)
    second_response = client.post("/api/onboarding/register", data=second_data, files=second_files)

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    pending_ids = sorted(
        row.sevak_id
        for row in db_session.query(Sevak).filter(Sevak.email.like("%.pending@example.com")).all()
    )
    assert pending_ids == [-2, -1]


def test_onboarding_rejects_duplicate_email_case_insensitively(
    api_client_factory,
    make_sevak,
    monkeypatch,
):
    current_user = make_sevak(sevak_id=10000, email="super@example.com")
    make_sevak(sevak_id=10007, email="teja@example.com")
    monkeypatch.setattr("app.api.onboarding.save_document_upload", _fake_save_document_upload)
    monkeypatch.setattr("app.api.onboarding.send_account_activation_email", lambda **kwargs: True)
    client = api_client_factory(current_user)

    data, files = _registration_payload("TEJA@EXAMPLE.COM")

    response = client.post("/api/onboarding/register", data=data, files=files)

    assert response.status_code == 400
    assert response.json()["detail"] == "Email already registered"


def test_onboarding_stores_normalized_email(
    api_client_factory,
    db_session,
    make_sevak,
    monkeypatch,
):
    current_user = make_sevak(sevak_id=10000, email="super@example.com")
    monkeypatch.setattr("app.api.onboarding.save_document_upload", _fake_save_document_upload)
    monkeypatch.setattr("app.api.onboarding.send_account_activation_email", lambda **kwargs: True)
    client = api_client_factory(current_user)

    data, files = _registration_payload("  NEW.USER@EXAMPLE.COM  ")

    response = client.post("/api/onboarding/register", data=data, files=files)

    assert response.status_code == 200
    created = db_session.query(Sevak).filter(Sevak.email == "new.user@example.com").one()
    assert created.email == "new.user@example.com"


def test_onboarding_returns_storage_errors_without_crashing(
    api_client_factory,
    make_sevak,
    monkeypatch,
):
    current_user = make_sevak(sevak_id=10000, email="super@example.com")

    async def fail_upload(*args, **kwargs):
        raise HTTPException(
            status_code=500,
            detail="Document storage is not configured. Missing: R2_BUCKET_NAME",
        )

    monkeypatch.setattr("app.api.onboarding.save_document_upload", fail_upload)
    monkeypatch.setattr("app.api.onboarding.send_account_activation_email", lambda **kwargs: True)
    client = api_client_factory(current_user)

    data, files = _registration_payload("storage.error@example.com")

    response = client.post(
        "/api/onboarding/register",
        data=data,
        files=files,
        headers={"Origin": "https://fix-onboarding-production-re.anix-hrms.pages.dev"},
    )

    assert response.status_code == 500
    assert response.json()["detail"] == "Document storage is not configured. Missing: R2_BUCKET_NAME"
