#!/usr/bin/env python3
"""
Direct database fix for HODs without departments.
"""
import os
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Read the database URL from the environment (see backend/.env.example).
os.environ.setdefault(
    'DATABASE_URL',
    'postgresql://postgres:yourpassword@localhost:5432/anix_hrms',
)

try:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.models.sevak import Sevak, RoleEnum

    DATABASE_URL = os.getenv('DATABASE_URL')
    engine = create_engine(DATABASE_URL)
    SessionLocal = sessionmaker(bind=engine)

    db = SessionLocal()

    # Find and fix HODs without departments
    problematic_hods = db.query(Sevak).filter(
        Sevak.role == RoleEnum.HOD,
        Sevak.department_id == None
    ).all()

    if not problematic_hods:
        print("[OK] All HODs have departments assigned. Data is clean!")
    else:
        print(f"[FOUND] {len(problematic_hods)} HOD(s) without departments:")
        for hod in problematic_hods:
            print(f"  - Sevak {hod.sevak_id}: {hod.first_name} {hod.last_name}")
            hod.role = RoleEnum.SEVAK

        db.commit()
        print(f"[FIXED] {len(problematic_hods)} sevak(s)")

    db.close()

except Exception as e:
    print(f"[ERROR] {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
