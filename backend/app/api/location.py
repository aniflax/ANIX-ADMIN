from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Optional
from pydantic import BaseModel
from app.core.dependencies import DbSession, CurrentEmployee
from app.models.employee import RoleEnum
from app.models.location import Location
from app.models.department_location import DepartmentLocation
from app.models.department import Department

router = APIRouter(prefix="/api/locations", tags=["Location Management"])


class LocationCreate(BaseModel):
    name: str
    address: Optional[str] = None
    latitude: float
    longitude: float
    geo_threshold_meters: int = 500


class LocationUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    geo_threshold_meters: Optional[int] = None


def require_super_admin(current_user: CurrentEmployee):
    if current_user.role != RoleEnum.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admin can manage locations"
        )


@router.get("/")
def get_locations(db: DbSession, current_user: CurrentEmployee):
    """Get all active locations."""
    locations = db.query(Location).filter(Location.is_active == True).order_by(Location.name).all()
    return [{
        "id": loc.id,
        "name": loc.name,
        "address": loc.address,
        "latitude": loc.latitude,
        "longitude": loc.longitude,
        "geo_threshold_meters": loc.geo_threshold_meters
    } for loc in locations]


@router.get("/{location_id}")
def get_location(location_id: str, db: DbSession, current_user: CurrentEmployee):
    """Get a single location with departments using it."""
    location = db.query(Location).filter(Location.id == location_id, Location.is_active == True).first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    
    # Get departments using this location
    dept_links = db.query(DepartmentLocation).filter(DepartmentLocation.location_id == location_id).all()
    dept_ids = [dl.department_id for dl in dept_links]
    departments = db.query(Department).filter(Department.id.in_(dept_ids), Department.is_active == True).all() if dept_ids else []
    
    return {
        "id": location.id,
        "name": location.name,
        "address": location.address,
        "latitude": location.latitude,
        "longitude": location.longitude,
        "geo_threshold_meters": location.geo_threshold_meters,
        "departments": [{
            "id": d.id,
            "name": d.name,
            "is_primary": any(dl.department_id == d.id and dl.is_primary for dl in dept_links)
        } for d in departments]
    }


@router.post("/")
def create_location(data: LocationCreate, db: DbSession, current_user: CurrentEmployee):
    """Create a new location. SuperAdmin only."""
    require_super_admin(current_user)
    
    existing = db.query(Location).filter(Location.name == data.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Location name already exists")
    
    location = Location(
        name=data.name,
        address=data.address,
        latitude=data.latitude,
        longitude=data.longitude,
        geo_threshold_meters=data.geo_threshold_meters,
        is_active=True
    )
    db.add(location)
    db.commit()
    db.refresh(location)
    
    return {
        "id": location.id,
        "name": location.name,
        "address": location.address,
        "latitude": location.latitude,
        "longitude": location.longitude,
        "geo_threshold_meters": location.geo_threshold_meters
    }


@router.put("/{location_id}")
def update_location(location_id: str, data: LocationUpdate, db: DbSession, current_user: CurrentEmployee):
    """Update a location. SuperAdmin only."""
    require_super_admin(current_user)
    
    location = db.query(Location).filter(Location.id == location_id, Location.is_active == True).first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    
    if data.name is not None:
        existing = db.query(Location).filter(Location.name == data.name, Location.id != location_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Location name already exists")
        location.name = data.name
    if data.address is not None:
        location.address = data.address
    if data.latitude is not None:
        location.latitude = data.latitude
    if data.longitude is not None:
        location.longitude = data.longitude
    if data.geo_threshold_meters is not None:
        location.geo_threshold_meters = data.geo_threshold_meters
    
    db.commit()
    db.refresh(location)
    
    return {
        "id": location.id,
        "name": location.name,
        "address": location.address,
        "latitude": location.latitude,
        "longitude": location.longitude,
        "geo_threshold_meters": location.geo_threshold_meters
    }


@router.delete("/{location_id}")
def delete_location(location_id: str, db: DbSession, current_user: CurrentEmployee):
    """Delete (deactivate) a location. SuperAdmin only."""
    require_super_admin(current_user)
    
    location = db.query(Location).filter(Location.id == location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    
    active_dept_count = db.query(DepartmentLocation).join(
        Department, Department.id == DepartmentLocation.department_id
    ).filter(
        DepartmentLocation.location_id == location_id,
        Department.is_active == True
    ).count()
    if active_dept_count > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete. Location is used by {active_dept_count} department(s).")
    
    location.is_active = False
    db.commit()
    return {"message": "Location deleted"}
