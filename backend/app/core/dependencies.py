from typing import Annotated
from sqlalchemy.orm import Session
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.employee import Employee, RoleEnum, EmployeeStatusEnum

# DB dependency
DbSession = Annotated[Session, Depends(get_db)]

# OAuth2 scheme — looks for token in Authorization header
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_employee(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: DbSession
) -> Employee:
    """Get currently logged in Employee from JWT token."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = decode_access_token(token)
    if payload is None:
        raise credentials_exception

    employee_id: str = payload.get("sub")
    if employee_id is None:
        raise credentials_exception

    employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if employee is None:
        raise credentials_exception

    if employee.status == EmployeeStatusEnum.LOCKED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is locked. Please contact Admin."
        )

    if not employee.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive."
        )

    return employee


# Role-based access dependencies
CurrentEmployee = Annotated[Employee, Depends(get_current_employee)]


def require_roles(*roles: RoleEnum):
    """Dependency factory — restricts access to specific roles."""
    def role_checker(
        current_employee: Annotated[Employee, Depends(get_current_employee)]
    ) -> Employee:
        if current_employee.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action."
            )
        return current_employee
    return role_checker


# Pre-built role dependencies — use these in routes
RequireSuperAdmin = Depends(require_roles(RoleEnum.SUPER_ADMIN))

RequireAdmin = Depends(require_roles(
    RoleEnum.SUPER_ADMIN,
    RoleEnum.ADMIN
))

RequireHR = Depends(require_roles(
    RoleEnum.SUPER_ADMIN,
    RoleEnum.ADMIN,
    RoleEnum.HR
))

RequireHoD = Depends(require_roles(
    RoleEnum.SUPER_ADMIN,
    RoleEnum.ADMIN,
    RoleEnum.HR,
    RoleEnum.HOD
))

RequireAnyEmployee = Depends(require_roles(
    RoleEnum.SUPER_ADMIN,
    RoleEnum.ADMIN,
    RoleEnum.HR,
    RoleEnum.HOD,
    RoleEnum.EMPLOYEE
))