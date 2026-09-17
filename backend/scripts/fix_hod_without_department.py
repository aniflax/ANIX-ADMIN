#!/usr/bin/env python
"""
Fix HODs without department assignment.
Downgrades any HOD that doesn't have a department_id to SEVAK role.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from app.core.database import SessionLocal
from app.models.sevak import Sevak, RoleEnum
from sqlalchemy import and_

db = SessionLocal()

try:
    # Find all HODs without a department
    hods_without_dept = db.query(Sevak).filter(
        and_(
            Sevak.role == RoleEnum.HOD,
            Sevak.department_id == None
        )
    ).all()

    if not hods_without_dept:
        print("✓ No HODs without departments found. Data is consistent!")
        sys.exit(0)

    print(f"Found {len(hods_without_dept)} HOD(s) without department:")
    for sevak in hods_without_dept:
        print(f"  - Sevak ID {sevak.sevak_id}: {sevak.first_name} {sevak.last_name} (Role: {sevak.role})")

    # Fix them
    fixed_count = 0
    for sevak in hods_without_dept:
        sevak.role = RoleEnum.SEVAK
        db.add(sevak)
        fixed_count += 1
        print(f"  ✓ Downgraded Sevak {sevak.sevak_id} from HOD to SEVAK")

    db.commit()
    print(f"\n✓ Successfully fixed {fixed_count} sevak(s)")

finally:
    db.close()
