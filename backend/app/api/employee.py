from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.responses import Response
from datetime import datetime
from typing import List, Optional
from app.core.config import settings
from app.core.dependencies import DbSession, CurrentEmployee
from app.services.attendance import get_local_now
from app.schemas.employee import (
    AccountCredentialsEmailRequest,
    AdminAccountCreate,
    AdminAccountCreateResponse,
    AdminAccountOtpRequest,
    AdminAccountOtpResponse,
    AdminAccountOtpVerifyRequest,
    AdminAccountOtpVerifyResponse,
    DeleteRequestResponse,
    EmployeeCreate,
    EmployeeUpdate,
    EmployeeAdminUpdate,
    EmployeeResponse,
    LockedAccountResponse,
)

from app.services.employee import (
    create_employee,
    create_privileged_account,
    get_all_employees,
    get_onboarding_employees,
    get_employee_by_id,
    request_admin_account_email_otp,
    update_employee_profile,
    admin_update_employee,
    verify_admin_account_email_otp,
)
from app.models.employee import RoleEnum, Employee as EmployeeModel, AccountEvent, EmployeeStatusEnum
from app.models.attendance import AttendanceLog
from app.models.leave import LeaveBalance, LeaveRequest
from app.models.employee_location import EmployeeLocation
from app.models.audit import AuditLog
from app.services.notifications import create_password_reset_notification, send_account_credentials_email
from app.services.auth import resend_activation_email
from app.services.storage import get_document, save_document_upload
from app.services.week_off_history import serialize_week_off_history
from sqlalchemy import desc


router = APIRouter(prefix="/api/employees", tags=["Employee Management"])


def serialize_employee_response(db, employee):
    data = {**employee.__dict__}
    data["week_off_history"] = serialize_week_off_history(db, employee)
    return data


@router.post("/", response_model=EmployeeResponse, status_code=status.HTTP_201_CREATED)
def create_new_employee(
    employee_in: EmployeeCreate,
    current_user: CurrentEmployee,
    db: DbSession
):
    """Create a new Employee (Admin/HR only)."""
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to create a Employee"
        )
    return create_employee(db=db, employee_in=employee_in, created_by=current_user)


@router.get("/", response_model=List[EmployeeResponse])
def get_employees(
    current_user: CurrentEmployee,
    db: DbSession,
    skip: int = 0,
    limit: int = 100,
    department_id: Optional[str] = None
):
    """List all Employees based on Role visibility rules."""
    return get_all_employees(
        db=db,
        current_user=current_user,
        skip=skip,
        limit=limit,
        department_id=department_id
    )


# ─── Admin GET routes MUST be above /{employee_id} to avoid being shadowed ─────────

@router.get("/admin/accounts", response_model=List[EmployeeResponse])
def get_all_accounts(db: DbSession, current_user: CurrentEmployee):
    """Admin/SuperAdmin: Get ALL accounts (any status) for management."""
    if current_user.role not in [RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Not authorised.")
    return db.query(EmployeeModel).order_by(EmployeeModel.employee_id).all()


@router.post("/admin/accounts", response_model=AdminAccountCreateResponse, status_code=status.HTTP_201_CREATED)
def create_admin_or_hr_account(
    payload: AdminAccountCreate,
    db: DbSession,
    current_user: CurrentEmployee,
):
    """SuperAdmin: Create reserved Admin/HR accounts."""
    account, temporary_password, invitation_sent = create_privileged_account(
        db=db,
        account_in=payload,
        created_by=current_user,
    )
    return {
        "account": account,
        "temporary_password": temporary_password,
        "invitation_sent": invitation_sent,
        "message": (
            f"{account.role.value.replace('_', ' ')} account {account.employee_id} created. "
            "Share the one-time password securely and ask the recipient to activate their account."
        ),
    }


@router.post("/admin/accounts/otp/send", response_model=AdminAccountOtpResponse)
def send_admin_or_hr_account_otp(
    payload: AdminAccountOtpRequest,
    db: DbSession,
    current_user: CurrentEmployee,
):
    """SuperAdmin: Send OTP before Admin/HR account information is accepted."""
    email, otp_token, sent = request_admin_account_email_otp(
        db=db,
        email=payload.email,
        requested_by=current_user,
    )
    environment = settings.ENVIRONMENT.lower()
    if not sent and environment not in {"development", "test"}:
        raise HTTPException(status_code=500, detail="Failed to send OTP email.")
    return {
        "email": email,
        "otp_token": otp_token,
        "message": f"OTP sent to {email}.",
    }


@router.post("/admin/accounts/otp/verify", response_model=AdminAccountOtpVerifyResponse)
def verify_admin_or_hr_account_otp(
    payload: AdminAccountOtpVerifyRequest,
    current_user: CurrentEmployee,
):
    """SuperAdmin: Verify OTP and issue a short-lived account creation token."""
    if current_user.role != RoleEnum.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Only SuperAdmin can verify account OTP.")
    email, verification_token = verify_admin_account_email_otp(
        email=payload.email,
        otp=payload.otp,
        otp_token=payload.otp_token,
    )
    return {
        "email": email,
        "email_verification_token": verification_token,
        "message": "Email verified. Enter account information to continue.",
    }


@router.post("/admin/accounts/{employee_id}/send-credentials")
def send_admin_or_hr_credentials(
    employee_id: str,
    payload: AccountCredentialsEmailRequest,
    db: DbSession,
    current_user: CurrentEmployee,
):
    """SuperAdmin: Send the generated account ID and temporary password."""
    if current_user.role != RoleEnum.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Only SuperAdmin can send account credentials.")

    account = get_employee_by_id(db, employee_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found.")
    if account.role not in [RoleEnum.ADMIN, RoleEnum.HR]:
        raise HTTPException(status_code=400, detail="Credentials can be sent only for Admin or HR accounts.")
    if not account.email:
        raise HTTPException(status_code=400, detail="Account does not have an email address configured.")

    login_link = f"{settings.FRONTEND_URL.rstrip('/')}/login"
    sent = send_account_credentials_email(
        db=db,
        employee=account,
        temporary_password=payload.temporary_password,
        login_link=login_link,
        requested_by_name=f"{current_user.first_name} {current_user.last_name}",
    )
    if not sent:
        raise HTTPException(status_code=500, detail="Failed to send login details email.")
    return {"message": f"Login details sent to {account.email}."}


@router.get("/admin/delete-requests", response_model=List[DeleteRequestResponse])
def get_delete_requests(db: DbSession, current_user: CurrentEmployee):
    """Admin/SuperAdmin: Get accounts with pending delete request, with requester name resolved."""
    if current_user.role not in [RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Not authorised.")
    results = []
    for employee in db.query(EmployeeModel).filter(EmployeeModel.delete_requested == True).all():
        requester_name = None
        if employee.delete_requested_by:
            requester = db.query(EmployeeModel).filter(EmployeeModel.id == employee.delete_requested_by).first()
            if requester:
                requester_name = f"{requester.first_name} {requester.last_name}"
        results.append(DeleteRequestResponse(
            id=employee.id,
            employee_id=employee.employee_id,
            first_name=employee.first_name,
            last_name=employee.last_name,
            email=employee.email,
            role=employee.role,
            delete_requested_by=employee.delete_requested_by,
            delete_requested_by_name=requester_name or "Unknown",
        ))
    return results


@router.get("/onboarding", response_model=List[EmployeeResponse])
def get_employees_onboarding(
    db: DbSession,
    current_user: CurrentEmployee,
    month: Optional[int] = None,
    year: Optional[int] = None,
    cutoff: Optional[int] = None,
):
    """HR/Admin/SuperAdmin: Get all self-onboarded employees (both activated and pending).
    Filter by financial month using month+year+cutoff params.
    Financial month: (cutoff+1) of prev calendar month to cutoff of current calendar month.
    E.g. month=4, year=2026, cutoff=20 => 21 Mar 2026 to 20 Apr 2026.
    """
    start_date = None
    end_date = None
    if month is not None and year is not None:
        # Resolve cutoff from DB if not provided by client
        if cutoff is None:
            from app.models.department import SystemConfig
            cfg = db.query(SystemConfig).filter(SystemConfig.key == "FINANCIAL_CUTOFF_DATE").first()
            cutoff = int(cfg.value) if cfg and cfg.value else 20
        cutoff = max(1, min(cutoff, 27))  # guard: clamp between 1 and 27
        prev_month = 12 if month == 1 else month - 1
        prev_year = year - 1 if month == 1 else year
        start_date = datetime(prev_year, prev_month, cutoff + 1, 0, 0, 0)
        end_date = datetime(year, month, cutoff, 23, 59, 59)
    return get_onboarding_employees(db=db, current_user=current_user, start_date=start_date, end_date=end_date)


@router.get("/admin/locked-list", response_model=List[LockedAccountResponse])
def get_locked_accounts(db: DbSession, current_user: CurrentEmployee):
    """Admin/SuperAdmin: Get list of locked accounts with reasons."""
    if current_user.role not in [RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Not authorised.")

    locked_employees = db.query(EmployeeModel).filter(EmployeeModel.status == EmployeeStatusEnum.LOCKED).all()
    results = []
    for s in locked_employees:
        # Get the latest LOCK event for this user
        last_event = db.query(AccountEvent).filter(
            AccountEvent.employee_id == s.id,
            AccountEvent.event_type == "LOCKED"
        ).order_by(desc(AccountEvent.timestamp)).first()

        results.append({
            "id": s.id,
            "employee_id": s.employee_id,
            "first_name": s.first_name,
            "last_name": s.last_name,
            "email": s.email,
            "email_verified": s.email_verified,
            "phone": s.phone,
            "lock_reason": last_event.notes if last_event else "Account locked out (Admin review required)",
            "locked_at": last_event.timestamp if last_event else s.updated_at,
            "reset_pending": False
        })
    return results


@router.delete("/admin/system/clean", status_code=status.HTTP_204_NO_CONTENT)
def system_data_cleanup(
    db: DbSession,
    current_user: CurrentEmployee
):
    """SUPER ADMIN ONLY - Wipes non-admin app data as requested."""
    if current_user.role != RoleEnum.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Only SUPER_ADMIN can perform data resets.")

    from app.models.attendance import AttendanceLog
    from app.models.leave import LeaveRequest, LeaveBalance, LeaveType
    from app.models.department import Department
    from app.models.employee import Employee, AccountEvent
    from app.models.employee_location import EmployeeLocation
    from app.models.week_off_history import EmployeeWeekOffHistory

    try:
        db.query(AccountEvent).delete()
        db.query(EmployeeLocation).delete()
        db.query(EmployeeWeekOffHistory).delete()
        db.query(AttendanceLog).delete()
        db.query(LeaveRequest).delete()
        db.query(LeaveBalance).delete()
        db.query(Employee).update({"department_id": None}, synchronize_session=False)
        db.query(Department).update({"hod_id": None}, synchronize_session=False)
        db.commit()
        db.query(Department).delete()
        db.query(Employee).filter(Employee.role != RoleEnum.SUPER_ADMIN).delete()
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to reset data: {str(e)}")


# ─── Dynamic /{employee_id} routes MUST come after all /admin/* routes ──────────

@router.get("/{employee_id}", response_model=EmployeeResponse)
def get_employee(
    employee_id: str,
    current_user: CurrentEmployee,
    db: DbSession
):
    """Get a specific Employee."""
    employee = get_employee_by_id(db=db, id=employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    # Visibility checks
    if current_user.role == RoleEnum.EMPLOYEE and current_user.id != employee_id:
        raise HTTPException(status_code=403, detail="Not authorized to view this profile")
    if current_user.role == RoleEnum.HOD and current_user.department_id != employee.department_id:
        raise HTTPException(status_code=403, detail="Not authorized to view this profile")

    return serialize_employee_response(db, employee)


@router.put("/{employee_id}", response_model=EmployeeResponse)
def update_employee(
    employee_id: str,
    employee_in: EmployeeUpdate,
    current_user: CurrentEmployee,
    db: DbSession
):
    """Update profile logic. Users can update their own general info."""
    db_employee = get_employee_by_id(db=db, id=employee_id)
    if not db_employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    # Standard profile edit restriction
    if current_user.role == RoleEnum.EMPLOYEE and current_user.id != db_employee.id:
        raise HTTPException(status_code=403, detail="Cannot update other users")

    updated = update_employee_profile(db=db, db_employee=db_employee, employee_in=employee_in)
    return serialize_employee_response(db, updated)


@router.put("/{employee_id}/admin", response_model=EmployeeResponse)
def admin_update(
    employee_id: str,
    employee_in: EmployeeAdminUpdate,
    current_user: CurrentEmployee,
    db: DbSession
):
    """Admin updates for strict fields like role and status."""
    db_employee = get_employee_by_id(db=db, id=employee_id)
    if not db_employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    updated = admin_update_employee(db=db, db_employee=db_employee, employee_in=employee_in, current_user=current_user)
    return serialize_employee_response(db, updated)


@router.post("/{employee_id}/documents", response_model=EmployeeResponse)
async def upload_document(
    employee_id: str,
    db: DbSession,
    current_user: CurrentEmployee,
    doc_type: str = Form(...),
    file: UploadFile = File(...)
):
    """Upload or update a single document for a Employee (HR only)."""
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Only HR/Admin can modify documents.")

    db_employee = get_employee_by_id(db=db, id=employee_id)
    if not db_employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    if doc_type not in ['id_proof', 'pan_card', 'passbook']:
        raise HTTPException(status_code=400, detail="Invalid document type")

    stored = await save_document_upload(file, employee_id=db_employee.id, doc_type=doc_type)

    if doc_type == 'id_proof':
        db_employee.id_proof_path = stored.key
    elif doc_type == 'pan_card':
        db_employee.pan_card_path = stored.key
    elif doc_type == 'passbook':
        db_employee.passbook_path = stored.key

    db.commit()
    db.refresh(db_employee)
    return db_employee


@router.get("/{employee_id}/documents/{doc_type}")
def download_document(
    employee_id: str,
    doc_type: str,
    db: DbSession,
    current_user: CurrentEmployee,
):
    """Serve private Employee documents through authenticated API access."""
    db_employee = get_employee_by_id(db=db, id=employee_id)
    if not db_employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    if current_user.role == RoleEnum.EMPLOYEE and current_user.id != db_employee.id:
        raise HTTPException(status_code=403, detail="Not authorized to view this document")
    if current_user.role == RoleEnum.HOD and current_user.department_id != db_employee.department_id:
        raise HTTPException(status_code=403, detail="Not authorized to view this document")
    if current_user.role not in [RoleEnum.EMPLOYEE, RoleEnum.HOD, RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Not authorized to view this document")

    document_key = {
        "id_proof": db_employee.id_proof_path,
        "pan_card": db_employee.pan_card_path,
        "passbook": db_employee.passbook_path,
    }.get(doc_type)
    if not document_key:
        raise HTTPException(status_code=404, detail="Document not found")

    document = get_document(document_key)
    return Response(
        content=document.body,
        media_type=document.content_type,
        headers={
            "Content-Disposition": f'inline; filename="{document.filename}"',
            "Cache-Control": "private, max-age=300",
        },
    )


# ─── Account Management (POST routes for /{employee_id}) ───────────────────────────


@router.post("/{employee_id}/unlock")
def unlock_account(employee_id: str, db: DbSession, current_user: CurrentEmployee):
    """Admin/SuperAdmin: Unlock a locked account."""
    if current_user.role not in [RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Not authorised.")
    employee = get_employee_by_id(db, employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found.")
    employee.status = EmployeeStatusEnum.ACTIVE
    employee.failed_login_attempts = 0
    event = AccountEvent(
        employee_id=employee.id,
        event_type="UNLOCKED",
        resolved_by=current_user.id,
        resolved_at=get_local_now()
    )
    db.add(event)
    db.commit()
    return {"message": f"Account {employee.employee_id} unlocked successfully."}


@router.post("/{employee_id}/lock")
def lock_account(employee_id: str, db: DbSession, current_user: CurrentEmployee):
    """Admin/SuperAdmin: Lock an account manually."""
    if current_user.role not in [RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Not authorised.")
    employee = get_employee_by_id(db, employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found.")

    if employee.role == RoleEnum.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Super Admin accounts cannot be locked.")

    employee.status = EmployeeStatusEnum.LOCKED
    event = AccountEvent(
        employee_id=employee.id,
        event_type="LOCKED",
        resolved_by=current_user.id,
        notes="Account locked manually by Admin"
    )
    db.add(event)
    db.commit()

    return {"message": f"Account {employee.employee_id} locked successfully."}


@router.post("/{employee_id}/activate")
def activate_account(employee_id: str, db: DbSession, current_user: CurrentEmployee):
    """Admin/HR: Activate a deactivated account. Auto-clears any pending delete request."""
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Not authorised.")
    employee = get_employee_by_id(db, employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found.")
    employee.status = EmployeeStatusEnum.ACTIVE
    employee.activated_at = get_local_now()
    employee.delete_requested = False
    employee.delete_requested_by = None
    event = AccountEvent(
        employee_id=employee.id,
        event_type="ACTIVATED",
        resolved_by=current_user.id,
        notes="Account activated from HR/Admin directory"
    )
    db.add(event)
    db.commit()
    return {"message": f"Account {employee.employee_id} activated successfully."}


@router.post("/{employee_id}/resend-activation-email")
def resend_activation_email_endpoint(employee_id: str, db: DbSession, current_user: CurrentEmployee):
    """Resend account activation email to a employee."""
    employee = get_employee_by_id(db, employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found.")

    if current_user.role == RoleEnum.EMPLOYEE and current_user.id != employee_id:
        raise HTTPException(status_code=403, detail="Not authorised.")

    if current_user.role not in [RoleEnum.EMPLOYEE, RoleEnum.HOD, RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Not authorised.")

    sent = resend_activation_email(
        db=db,
        employee=employee,
        requested_by_name=f"{current_user.first_name} {current_user.last_name}"
    )
    if not sent:
        raise HTTPException(status_code=500, detail="Failed to send activation email.")
    return {"message": f"Activation email sent to {employee.email} successfully."}


@router.post("/{employee_id}/reset-password-notify")
def reset_password_notify(employee_id: str, db: DbSession, current_user: CurrentEmployee):
    """Admin/SuperAdmin: Trigger password reset notification with email link."""
    if current_user.role not in [RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Not authorised.")
    employee = get_employee_by_id(db, employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found.")

    if not employee.email:
        raise HTTPException(status_code=400, detail="Employee does not have an email address configured.")

    sent = create_password_reset_notification(
        db=db,
        employee=employee,
        requested_by_id=current_user.id,
        requested_by_name=f"{current_user.first_name} {current_user.last_name}",
        notes=f"Reset link requested by {current_user.first_name} {current_user.last_name}",
    )

    if not sent:
        raise HTTPException(status_code=500, detail="Failed to send reset email.")

    return {"message": f"Password reset link sent to {employee.email} successfully."}


@router.post("/{employee_id}/delete-request")
def request_deletion(employee_id: str, db: DbSession, current_user: CurrentEmployee):
    """HR: Flag an inactive account for deletion review by Admin/SuperAdmin."""
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Not authorised.")
    employee = get_employee_by_id(db, employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found.")
    if employee.status != EmployeeStatusEnum.INACTIVE:
        raise HTTPException(status_code=400, detail="Only INACTIVE accounts can be flagged for deletion.")
    employee.delete_requested = True
    employee.delete_requested_by = current_user.id
    db.commit()
    return {"message": "Deletion request submitted. Admin will review."}


@router.delete("/{employee_id}/delete-request")
def withdraw_delete_request(employee_id: str, db: DbSession, current_user: CurrentEmployee):
    """HR/Admin: Withdraw a pending delete request."""
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Not authorised.")
    employee = get_employee_by_id(db, employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found.")
    if not employee.delete_requested:
        raise HTTPException(status_code=400, detail="No pending delete request for this account.")
    employee.delete_requested = False
    employee.delete_requested_by = None
    db.commit()
    return {"message": "Delete request withdrawn."}


@router.delete("/{employee_id}/hard-delete")
def hard_delete_account(employee_id: str, db: DbSession, current_user: CurrentEmployee):
    """SuperAdmin: Permanently delete account. Admin can delete if delete_requested=True."""
    employee = get_employee_by_id(db, employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found.")
    if employee.role == RoleEnum.SUPER_ADMIN:
        raise HTTPException(status_code=400, detail="Cannot delete SuperAdmin account.")

    if current_user.role == RoleEnum.ADMIN and not employee.delete_requested:
        raise HTTPException(status_code=403, detail="Account has no pending delete request. Request deletion first.")
    if current_user.role not in [RoleEnum.SUPER_ADMIN, RoleEnum.ADMIN]:
        raise HTTPException(status_code=403, detail="Not authorised.")

    # Remove or detach records that reference this Employee so FK constraints don't block deletion.
    db.query(AttendanceLog).filter(AttendanceLog.employee_id == employee.id).delete(synchronize_session=False)
    db.query(AttendanceLog).filter(AttendanceLog.unlocked_by_id == employee.id).update(
        {AttendanceLog.unlocked_by_id: None},
        synchronize_session=False
    )
    db.query(LeaveBalance).filter(LeaveBalance.employee_id == employee.id).delete(synchronize_session=False)
    db.query(LeaveRequest).filter(LeaveRequest.employee_id == employee.id).delete(synchronize_session=False)
    db.query(LeaveRequest).filter(LeaveRequest.approver_hod_id == employee.id).update(
        {LeaveRequest.approver_hod_id: None},
        synchronize_session=False
    )
    db.query(LeaveRequest).filter(LeaveRequest.approver_hr_id == employee.id).update(
        {LeaveRequest.approver_hr_id: None},
        synchronize_session=False
    )
    db.query(EmployeeLocation).filter(EmployeeLocation.employee_id == employee.id).delete(synchronize_session=False)
    db.query(AccountEvent).filter(AccountEvent.employee_id == employee.id).delete(synchronize_session=False)
    db.query(AuditLog).filter(AuditLog.performed_by == employee.id).delete(synchronize_session=False)

    if current_user.role in [RoleEnum.SUPER_ADMIN, RoleEnum.ADMIN]:
        db.delete(employee)
        db.commit()
        return {"message": "Account permanently deleted."}
    else:
        raise HTTPException(status_code=403, detail="Not authorised.")
