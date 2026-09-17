from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Optional
from pydantic import BaseModel
from app.core.dependencies import DbSession, CurrentEmployee
from app.schemas.department import DepartmentResponse, DepartmentCreate, DepartmentUpdate
from app.services.department import (
    get_departments, get_department, create_department, update_department, delete_department,
    get_department_locations, add_department_location, update_department_location, delete_department_location
)
from app.models.employee import RoleEnum

router = APIRouter(prefix="/api/departments", tags=["Department Management"])


class DepartmentLocationRequest(BaseModel):
    location_id: str
    is_primary: bool = False


@router.get("/")
def fetch_departments(db: DbSession, current_user: CurrentEmployee):
    return get_departments(db=db)


@router.get("/{dept_id}")
def fetch_department(dept_id: str, db: DbSession, current_user: CurrentEmployee):
    return get_department(db=db, dept_id=dept_id)


@router.post("/")
def add_department(dept_in: DepartmentCreate, db: DbSession, current_user: CurrentEmployee):
    return create_department(db=db, dept_data=dept_in, current_user=current_user)


@router.put("/{dept_id}")
def edit_department(dept_id: str, dept_in: DepartmentUpdate, db: DbSession, current_user: CurrentEmployee):
    return update_department(db=db, dept_id=dept_id, dept_data=dept_in, current_user=current_user)


@router.delete("/{dept_id}")
def remove_department(dept_id: str, db: DbSession, current_user: CurrentEmployee):
    delete_department(db=db, dept_id=dept_id, current_user=current_user)
    return {"message": "Department deactivated successfully"}


# Department Location Endpoints
@router.get("/{dept_id}/locations")
def fetch_department_locations(dept_id: str, db: DbSession, current_user: CurrentEmployee):
    """Get all locations for a department."""
    return get_department_locations(db=db, dept_id=dept_id)


@router.post("/{dept_id}/locations")
def add_location_to_department(dept_id: str, request: DepartmentLocationRequest, db: DbSession, current_user: CurrentEmployee):
    """Add a location to a department. HR and Admin only."""
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return add_department_location(db=db, dept_id=dept_id, location_id=request.location_id, is_primary=request.is_primary)


@router.put("/{dept_id}/locations/{location_id}")
def edit_department_location(dept_id: str, location_id: str, request: DepartmentLocationRequest, db: DbSession, current_user: CurrentEmployee):
    """Update department location. HR and Admin only."""
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return update_department_location(db=db, dept_id=dept_id, location_id=location_id, is_primary=request.is_primary)


@router.delete("/{dept_id}/locations/{location_id}")
def remove_department_location(dept_id: str, location_id: str, db: DbSession, current_user: CurrentEmployee):
    """Remove a location from a department. HR and Admin only."""
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    delete_department_location(db=db, dept_id=dept_id, location_id=location_id)
    return {"message": "Location removed successfully"}
