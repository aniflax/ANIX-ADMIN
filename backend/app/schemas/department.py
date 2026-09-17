from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime

class DepartmentBase(BaseModel):
    name: str
    description: Optional[str] = None
    hod_id: Optional[str] = None
    location_lat: Optional[float] = None
    location_lng: Optional[float] = None
    geo_threshold_meters: int = 500

class DepartmentCreate(DepartmentBase):
    pass

class DepartmentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    hod_id: Optional[str] = None
    location_lat: Optional[float] = None
    location_lng: Optional[float] = None
    geo_threshold_meters: Optional[int] = None
    is_active: Optional[bool] = None

class DepartmentResponse(DepartmentBase):
    id: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    employee_count: Optional[int] = 0

    class Config:
        from_attributes = True
