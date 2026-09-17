from sqlalchemy.orm import Session, joinedload
from fastapi import HTTPException
from typing import List
import uuid
from app.models.department import Department
from app.models.department_location import DepartmentLocation
from app.models.location import Location
from app.models.employee import Employee, RoleEnum
from app.schemas.department import DepartmentCreate, DepartmentUpdate


def _get_hod_candidate(db: Session, hod_id: str, *, current_department_id: str | None = None) -> Employee:
    candidate = db.query(Employee).filter(Employee.id == hod_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Selected HOD candidate not found")
    if candidate.role != RoleEnum.EMPLOYEE:
        raise HTTPException(status_code=400, detail="Only Employee profiles can be promoted to HOD")

    existing_hod_dept = db.query(Department).filter(
        Department.hod_id == hod_id,
        Department.id != current_department_id,
    ).first()
    if existing_hod_dept:
        raise HTTPException(
            status_code=400,
            detail=f"This employee is already HOD of department '{existing_hod_dept.name}'. A employee can be HOD for only one department.",
        )
    return candidate


def get_departments(db: Session, active_only: bool = True) -> List[dict]:
    query = db.query(Department)
    if active_only:
        query = query.filter(Department.is_active == True)
    
    depts = query.all()
    result = []
    
    for dept in depts:
        employee_count = db.query(Employee).filter(Employee.department_id == dept.id).count()
        
        # Get department locations
        dept_locations = db.query(DepartmentLocation).filter(
            DepartmentLocation.department_id == dept.id
        ).all()
        
        location_ids = [dl.location_id for dl in dept_locations]
        locations = db.query(Location).filter(Location.id.in_(location_ids)).all() if location_ids else []
        
        result.append({
            "id": dept.id,
            "name": dept.name,
            "description": dept.description,
            "hod_id": dept.hod_id,
            "is_active": dept.is_active,
            "created_at": dept.created_at,
            "updated_at": dept.updated_at,
            "employee_count": employee_count,
            "locations": [{
                "id": loc.id,
                "name": loc.name,
                "latitude": loc.latitude,
                "longitude": loc.longitude,
                "geo_threshold_meters": loc.geo_threshold_meters,
                "is_primary": any(dl.location_id == loc.id and dl.is_primary for dl in dept_locations)
            } for loc in locations]
        })
    
    return result


def create_department(db: Session, dept_data: DepartmentCreate, current_user: Employee) -> dict:
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Only HR/Admin can create departments")
    
    name_normalized = (dept_data.name or '').strip()
    if not name_normalized:
        raise HTTPException(status_code=400, detail="Department name is required.")
    existing = db.query(Department).filter(
        Department.name.ilike(name_normalized)
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Department name already exists")

    new_hod = None
    if dept_data.hod_id:
        new_hod = _get_hod_candidate(db, dept_data.hod_id)
    
    dept = Department(
        name=name_normalized,
        description=dept_data.description,
        hod_id=dept_data.hod_id
    )
    db.add(dept)
    db.commit()
    db.refresh(dept)

    # If a HOD was assigned, update their department_id
    if new_hod:
        new_hod.role = RoleEnum.HOD
        new_hod.department_id = dept.id
        db.add(new_hod)
        db.commit()

    return {
        "id": dept.id,
        "name": dept.name,
        "description": dept.description,
        "hod_id": dept.hod_id,
        "is_active": dept.is_active,
        "employee_count": 0,
        "locations": []
    }


def get_department(db: Session, dept_id: str) -> dict:
    dept = db.query(Department).filter(Department.id == dept_id).first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    
    employee_count = db.query(Employee).filter(Employee.department_id == dept.id).count()
    
    # Get department locations
    dept_locations = db.query(DepartmentLocation).filter(
        DepartmentLocation.department_id == dept.id
    ).all()
    
    location_ids = [dl.location_id for dl in dept_locations]
    locations = db.query(Location).filter(Location.id.in_(location_ids)).all() if location_ids else []
    
    return {
        "id": dept.id,
        "name": dept.name,
        "description": dept.description,
        "hod_id": dept.hod_id,
        "is_active": dept.is_active,
        "created_at": dept.created_at,
        "updated_at": dept.updated_at,
        "employee_count": employee_count,
        "locations": [{
            "id": loc.id,
            "name": loc.name,
            "latitude": loc.latitude,
            "longitude": loc.longitude,
            "geo_threshold_meters": loc.geo_threshold_meters,
            "is_primary": any(dl.location_id == loc.id and dl.is_primary for dl in dept_locations)
        } for loc in locations]
    }


def update_department(db: Session, dept_id: str, dept_data: DepartmentUpdate, current_user: Employee) -> dict:
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Only HR/Admin can update departments")
        
    dept = db.query(Department).filter(Department.id == dept_id).first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    
    if dept_data.name is not None:
        # Check for duplicate name (case-insensitive, trimmed)
        name_normalized = dept_data.name.strip()
        if not name_normalized:
            raise HTTPException(status_code=400, detail="Department name is required.")
        existing = db.query(Department).filter(
            Department.name.ilike(name_normalized),
            Department.id != dept_id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Department name already exists")
        dept.name = name_normalized
    
    if dept_data.description is not None:
        dept.description = dept_data.description
    if dept_data.hod_id is not None:
        old_hod_id = dept.hod_id
        # Update the new HOD's role to HOD and assign department
        new_hod = None
        if dept_data.hod_id and dept_data.hod_id != old_hod_id:
            new_hod = _get_hod_candidate(db, dept_data.hod_id, current_department_id=dept_id)
        elif dept_data.hod_id == old_hod_id:
            new_hod = db.query(Employee).filter(Employee.id == dept_data.hod_id).first()

        if new_hod and dept_data.hod_id != old_hod_id:
            new_hod.role = RoleEnum.HOD
            new_hod.department_id = dept_id
            db.add(new_hod)
        dept.hod_id = dept_data.hod_id
        # If replacing old HOD, check if they are still HOD of any other department
        if old_hod_id and old_hod_id != dept_data.hod_id:
            still_hod = db.query(Department).filter(
                Department.hod_id == old_hod_id,
                Department.id != dept_id
            ).first()
            if not still_hod:
                old_hod = db.query(Employee).filter(Employee.id == old_hod_id).first()
                if old_hod and old_hod.role == RoleEnum.HOD:
                    old_hod.role = RoleEnum.EMPLOYEE
                    old_hod.department_id = None
                    db.add(old_hod)
        
    db.commit()
    db.refresh(dept)
    
    return get_department(db, dept_id)


def delete_department(db: Session, dept_id: str, current_user: Employee):
    if current_user.role not in [RoleEnum.HR, RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN]:
        raise HTTPException(status_code=403, detail="Only HR/Admin can delete departments")
        
    dept = db.query(Department).filter(Department.id == dept_id).first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    
    members = db.query(Employee).filter(Employee.department_id == dept.id).all()
    for member in members:
        member.department_id = None
        if member.role == RoleEnum.HOD:
            member.role = RoleEnum.EMPLOYEE
        db.add(member)
    
    if dept.hod_id:
        hod = db.query(Employee).filter(Employee.id == dept.hod_id).first()
        if hod:
            hod.department_id = None
            if hod.role == RoleEnum.HOD:
                hod.role = RoleEnum.EMPLOYEE
            db.add(hod)
    
    db.query(DepartmentLocation).filter(DepartmentLocation.department_id == dept.id).delete(synchronize_session=False)
    db.query(Department).filter(Department.hod_id == dept.hod_id).update(
        {"hod_id": None},
        synchronize_session=False
    )
    
    dept.is_active = False
    db.add(dept)
    db.commit()


# Department Location Functions
def get_department_locations(db: Session, dept_id: str) -> List[dict]:
    """Get all locations for a department."""
    dept = db.query(Department).filter(Department.id == dept_id).first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    
    dept_locations = db.query(DepartmentLocation).filter(
        DepartmentLocation.department_id == dept_id
    ).all()
    
    location_ids = [dl.location_id for dl in dept_locations]
    locations = db.query(Location).filter(Location.id.in_(location_ids), Location.is_active == True).all() if location_ids else []
    
    return [{
        "id": loc.id,
        "name": loc.name,
        "latitude": loc.latitude,
        "longitude": loc.longitude,
        "geo_threshold_meters": loc.geo_threshold_meters,
        "is_primary": any(dl.location_id == loc.id and dl.is_primary for dl in dept_locations)
    } for loc in locations]


def add_department_location(db: Session, dept_id: str, location_id: str, is_primary: bool = False) -> dict:
    """Add a location to a department."""
    dept = db.query(Department).filter(Department.id == dept_id).first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    
    location = db.query(Location).filter(Location.id == location_id, Location.is_active == True).first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    
    # Check if already linked
    existing = db.query(DepartmentLocation).filter(
        DepartmentLocation.department_id == dept_id,
        DepartmentLocation.location_id == location_id
    ).first()
    
    if existing:
        raise HTTPException(status_code=400, detail="Location already assigned to this department")
    
    # If this is set as primary, unset other primary locations
    if is_primary:
        db.query(DepartmentLocation).filter(
            DepartmentLocation.department_id == dept_id,
            DepartmentLocation.is_primary == True
        ).update({'is_primary': False})
    
    dept_loc = DepartmentLocation(
        id=str(uuid.uuid4()),
        department_id=dept_id,
        location_id=location_id,
        is_primary=is_primary
    )
    db.add(dept_loc)
    db.commit()
    db.refresh(dept_loc)
    
    return {
        "id": location.id,
        "name": location.name,
        "latitude": location.latitude,
        "longitude": location.longitude,
        "geo_threshold_meters": location.geo_threshold_meters,
        "is_primary": is_primary
    }


def update_department_location(db: Session, dept_id: str, location_id: str, is_primary: bool) -> dict:
    """Update department location (primarily for setting primary)."""
    dept_loc = db.query(DepartmentLocation).filter(
        DepartmentLocation.department_id == dept_id,
        DepartmentLocation.location_id == location_id
    ).first()
    
    if not dept_loc:
        raise HTTPException(status_code=404, detail="Location not assigned to this department")
    
    # If setting as primary, unset other primary locations
    if is_primary and not dept_loc.is_primary:
        db.query(DepartmentLocation).filter(
            DepartmentLocation.department_id == dept_id,
            DepartmentLocation.id != dept_loc.id,
            DepartmentLocation.is_primary == True
        ).update({'is_primary': False})
    
    dept_loc.is_primary = is_primary
    db.commit()
    
    location = db.query(Location).filter(Location.id == location_id).first()
    return {
        "id": location.id,
        "name": location.name,
        "latitude": location.latitude,
        "longitude": location.longitude,
        "geo_threshold_meters": location.geo_threshold_meters,
        "is_primary": is_primary
    }


def delete_department_location(db: Session, dept_id: str, location_id: str):
    """Remove a location from a department."""
    dept_loc = db.query(DepartmentLocation).filter(
        DepartmentLocation.department_id == dept_id,
        DepartmentLocation.location_id == location_id
    ).first()
    
    if not dept_loc:
        raise HTTPException(status_code=404, detail="Location not assigned to this department")
    
    # Check if at least one other location exists
    other_count = db.query(DepartmentLocation).filter(
        DepartmentLocation.department_id == dept_id,
        DepartmentLocation.location_id != location_id
    ).count()
    
    if other_count == 0:
        raise HTTPException(status_code=400, detail="Cannot remove the only location. Add another location first.")
    
    db.delete(dept_loc)
    db.commit()
