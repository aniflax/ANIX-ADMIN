from pathlib import Path

import pytest
from fastapi import HTTPException

from app.services.storage import build_document_key


def test_build_document_key_uses_private_r2_layout():
    key = build_document_key(
        employee_id="employee-123",
        doc_type="id_proof",
        original_filename="aadhaar.pdf",
    )

    assert key.startswith("employees/employee-123/id-proof/")
    assert key.endswith(".pdf")


def test_build_document_key_rejects_unsupported_extension():
    with pytest.raises(HTTPException) as exc:
        build_document_key(
            employee_id="employee-123",
            doc_type="pan_card",
            original_filename="pan.exe",
        )

    assert exc.value.status_code == 400
