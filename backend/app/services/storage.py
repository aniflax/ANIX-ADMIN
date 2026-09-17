import mimetypes
import os
import shutil
import uuid
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from fastapi import HTTPException, UploadFile

from app.core.config import settings

logger = logging.getLogger(__name__)

LOCAL_UPLOAD_DIR = Path("app/static/uploads")
MAX_DOCUMENT_SIZE = 2 * 1024 * 1024
MIN_DOCUMENT_SIZE = 100 * 1024
ALLOWED_CONTENT_TYPES = {"application/pdf", "image/jpeg", "image/png"}
ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}


@dataclass
class StoredObject:
    key: str
    content_type: str
    filename: str


@dataclass
class RetrievedObject:
    body: bytes
    content_type: str
    filename: str


def _document_folder(doc_type: str) -> str:
    return {
        "id_proof": "id-proof",
        "pan_card": "pan-card",
        "passbook": "passbook",
    }.get(doc_type, doc_type.replace("_", "-"))


def build_document_key(employee_id: str, doc_type: str, original_filename: str) -> str:
    ext = Path(original_filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        ext = mimetypes.guess_extension(mimetypes.guess_type(original_filename or "")[0] or "") or ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Upload PDF, JPG, JPEG, or PNG files only.")

    return f"employees/{employee_id}/{_document_folder(doc_type)}/{uuid.uuid4()}{ext}"


def _validate_document(filename: str, content_type: str, data: bytes) -> None:
    ext = Path(filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS and content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Upload PDF, JPG, JPEG, or PNG files only.")
    if len(data) < MIN_DOCUMENT_SIZE:
        raise HTTPException(status_code=400, detail="File is too small. Minimum size is 100 KB.")
    if len(data) > MAX_DOCUMENT_SIZE:
        raise HTTPException(status_code=400, detail="File is too large. Maximum size is 2 MB.")


def _content_type(filename: str, fallback: str | None) -> str:
    guessed = mimetypes.guess_type(filename or "")[0]
    return fallback or guessed or "application/octet-stream"


def _r2_client():
    try:
        import boto3
    except ImportError as exc:
        raise HTTPException(
            status_code=500,
            detail="Document storage is not available. Contact admin.",
        ) from exc

    endpoint_url = settings.R2_ENDPOINT_URL or f"https://{settings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )


def _ensure_r2_config() -> None:
    missing = [
        name
        for name, value in {
            "R2_ACCESS_KEY_ID": settings.R2_ACCESS_KEY_ID,
            "R2_SECRET_ACCESS_KEY": settings.R2_SECRET_ACCESS_KEY,
            "R2_BUCKET_NAME": settings.R2_BUCKET_NAME,
        }.items()
        if not value
    ]
    if not (settings.R2_ENDPOINT_URL or settings.R2_ACCOUNT_ID):
        missing.append("R2_ENDPOINT_URL or R2_ACCOUNT_ID")
    if missing:
        raise HTTPException(
            status_code=500,
            detail=f"Document storage is not configured. Missing: {', '.join(missing)}",
        )


async def save_document_upload(file: UploadFile, *, employee_id: str, doc_type: str) -> StoredObject:
    data = await file.read()
    filename = file.filename or f"{doc_type}.bin"
    content_type = _content_type(filename, file.content_type)
    _validate_document(filename, content_type, data)
    key = build_document_key(employee_id=employee_id, doc_type=doc_type, original_filename=filename)

    if settings.STORAGE_PROVIDER.lower() == "r2":
        _ensure_r2_config()
        try:
            _r2_client().put_object(
                Bucket=settings.R2_BUCKET_NAME,
                Key=key,
                Body=data,
                ContentType=content_type,
                Metadata={"original_filename": filename},
            )
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("R2 document upload failed for %s", key)
            raise HTTPException(
                status_code=502,
                detail="Document upload failed. Check Cloudflare R2 storage settings.",
            ) from exc
    else:
        path = LOCAL_UPLOAD_DIR / key
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as buffer:
            buffer.write(data)

    return StoredObject(key=key, content_type=content_type, filename=filename)


def get_document(key: str) -> RetrievedObject:
    if not key:
        raise HTTPException(status_code=404, detail="Document not found")

    if settings.STORAGE_PROVIDER.lower() == "r2":
        _ensure_r2_config()
        try:
            response = _r2_client().get_object(Bucket=settings.R2_BUCKET_NAME, Key=key)
        except Exception as exc:
            raise HTTPException(status_code=404, detail="Document not found") from exc
        body = response["Body"].read()
        content_type = response.get("ContentType") or _content_type(key, None)
        filename = response.get("Metadata", {}).get("original_filename") or Path(key).name
        return RetrievedObject(body=body, content_type=content_type, filename=filename)

    path = LOCAL_UPLOAD_DIR / key
    if not path.exists() and key.startswith("app/static/uploads/"):
        path = Path(key)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Document not found")
    return RetrievedObject(
        body=path.read_bytes(),
        content_type=_content_type(path.name, None),
        filename=path.name,
    )


def delete_document(key: str | None) -> None:
    if not key:
        return
    if settings.STORAGE_PROVIDER.lower() == "r2":
        try:
            _ensure_r2_config()
            _r2_client().delete_object(Bucket=settings.R2_BUCKET_NAME, Key=key)
        except Exception:
            return
    else:
        path = LOCAL_UPLOAD_DIR / key
        if not path.exists() and key.startswith("app/static/uploads/"):
            path = Path(key)
        try:
            path.unlink(missing_ok=True)
        except Exception:
            return


def migrate_local_file_to_storage(path: str, *, employee_id: str, doc_type: str) -> StoredObject:
    source = Path(path)
    if not source.exists():
        raise HTTPException(status_code=404, detail="Local document not found")
    key = build_document_key(employee_id=employee_id, doc_type=doc_type, original_filename=source.name)
    content_type = _content_type(source.name, None)

    if settings.STORAGE_PROVIDER.lower() == "r2":
        _ensure_r2_config()
        with open(source, "rb") as body:
            _r2_client().put_object(
                Bucket=settings.R2_BUCKET_NAME,
                Key=key,
                Body=body,
                ContentType=content_type,
                Metadata={"original_filename": source.name},
            )
    else:
        destination = LOCAL_UPLOAD_DIR / key
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)

    return StoredObject(key=key, content_type=content_type, filename=source.name)
