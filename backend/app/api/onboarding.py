from fastapi import APIRouter, UploadFile, File, Form, Request, status
from app.core.dependencies import DbSession
from app.models.employee import Employee, RoleEnum, EmployeeStatusEnum
from app.core.security import hash_password
from app.services.email_identity import ensure_email_available
from app.services.notifications import send_account_activation_email
from app.services.storage import save_document_upload
import uuid
from urllib.parse import urlparse

router = APIRouter(prefix="/api/onboarding", tags=["Onboarding"])

def _get_request_frontend_url(request: Request) -> str | None:
    origin = request.headers.get("origin")
    if origin and origin.startswith(("http://", "https://")):
        return origin

    referer = request.headers.get("referer")
    if referer and referer.startswith(("http://", "https://")):
        parsed = urlparse(referer)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}"

    return None


def _get_next_pending_employee_id(db: DbSession) -> int:
    lowest_pending = (
        db.query(Employee)
        .filter(Employee.employee_id <= 0)
        .order_by(Employee.employee_id.asc())
        .first()
    )
    if not lowest_pending:
        return -1
    return lowest_pending.employee_id - 1


@router.post("/register")
async def register_employee(
    request: Request,
    db: DbSession,
    first_name: str = Form(...),
    last_name: str = Form(...),
    email: str = Form(...),
    phone: str = Form(...),
    address: str = Form(...),
    password: str = Form(...),
    id_proof: UploadFile = File(...),
    pan_card: UploadFile = File(...),
    passbook: UploadFile = File(...)
):
    normalized_email = ensure_email_available(db, email)

    uid = str(uuid.uuid4())
    id_proof_object = await save_document_upload(id_proof, employee_id=uid, doc_type="id_proof")
    pan_card_object = await save_document_upload(pan_card, employee_id=uid, doc_type="pan_card")
    passbook_object = await save_document_upload(passbook, employee_id=uid, doc_type="passbook")

    # Create employee with pending status - ID will be allocated after email verification
    new_employee = Employee(
        id=uid,
        employee_id=_get_next_pending_employee_id(db),  # Temporary placeholder; real ID is allocated after verification
        first_name=first_name,
        last_name=last_name,
        email=normalized_email,
        email_verified=False,
        phone=phone,
        address=address,
        hashed_password=hash_password(password),
        id_proof_path=id_proof_object.key,
        pan_card_path=pan_card_object.key,
        passbook_path=passbook_object.key,
        role=RoleEnum.EMPLOYEE,
        status=EmployeeStatusEnum.INACTIVE  # Account inactive until email verified
    )

    db.add(new_employee)
    db.commit()
    db.refresh(new_employee)
    send_account_activation_email(
        db=db,
        employee=new_employee,
        requested_by_name="Onboarding",
        frontend_url=_get_request_frontend_url(request),
    )

    return {
        "message": "Registration submitted! Please check your email and click the activation link to activate your account and receive your Employee ID.",
    }
