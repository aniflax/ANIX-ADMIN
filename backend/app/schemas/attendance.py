from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
from app.models.attendance import AttendanceStatus, AttendanceSource

class AttendanceMarkRequest(BaseModel):
    lat: Optional[float] = None
    lng: Optional[float] = None
    source: AttendanceSource = AttendanceSource.WEB

class AttendanceManualUpdate(BaseModel):
    employee_id: str
    date: date
    check_in_time: Optional[datetime] = None
    check_out_time: Optional[datetime] = None
    status: AttendanceStatus = AttendanceStatus.PRESENT
    source: AttendanceSource = AttendanceSource.MANUAL

class AttendanceResponse(BaseModel):
    id: str
    employee_id: str
    date: date
    check_in_time: Optional[datetime] = None
    check_out_time: Optional[datetime] = None
    status: AttendanceStatus
    source: AttendanceSource
    location_lat: Optional[float] = None
    location_lng: Optional[float] = None
    location_name: Optional[str] = None
    location_status: Optional[str] = None
    location_map_url: Optional[str] = None
    geo_flagged: bool
    is_manual: bool
    unlocked_by_id: Optional[str] = None

    class Config:
        from_attributes = True
