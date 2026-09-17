#!/usr/bin/env python3
"""
Deep fix for orphaned HOD records and broken department references.
This handles:
1. Employees with role=HOD but no department_id
2. Departments pointing to non-existent or mismatched HODs
3. Ensures data consistency
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
os.environ.setdefault(
    'DATABASE_URL',
    'postgresql://postgres:yourpassword@localhost:5432/anix_hrms',
)

try:
    from sqlalchemy import create_engine, and_, or_
    from sqlalchemy.orm import sessionmaker
    from app.models.employee import Employee, RoleEnum
    from app.models.department import Department

    DATABASE_URL = os.getenv('DATABASE_URL')
    engine = create_engine(DATABASE_URL)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()

    print("[STARTING] Deep HOD data consistency fix...\n")

    # STEP 1: Find and list all problematic employees
    print("[STEP 1] Finding orphaned HODs (role=HOD but no department_id)...")
    orphaned_hods = db.query(Employee).filter(
        and_(
            Employee.role == RoleEnum.HOD,
            or_(Employee.department_id == None, Employee.department_id == '')
        )
    ).all()

    if orphaned_hods:
        print(f"  Found {len(orphaned_hods)} orphaned HOD(s):")
        for employee in orphaned_hods:
            print(f"    - Employee {employee.employee_id}: {employee.first_name} {employee.last_name}")
    else:
        print("  No orphaned HODs found")

    # STEP 2: Find departments that reference non-existent or orphaned HODs
    print("\n[STEP 2] Finding departments with broken HOD references...")
    all_depts = db.query(Department).filter(Department.hod_id != None).all()
    broken_depts = []

    for dept in all_depts:
        hod = db.query(Employee).filter(Employee.id == dept.hod_id).first()
        if not hod:
            print(f"  [BROKEN] Dept '{dept.name}' points to non-existent HOD {dept.hod_id}")
            broken_depts.append((dept, None))
        elif hod.department_id != dept.id:
            print(f"  [MISMATCH] Dept '{dept.name}' has HOD {hod.employee_id} but they're assigned to {hod.department_id}")
            broken_depts.append((dept, hod))

    # STEP 3: Fix orphaned HODs
    print(f"\n[STEP 3] Fixing {len(orphaned_hods)} orphaned HOD(s)...")
    for employee in orphaned_hods:
        employee.role = RoleEnum.EMPLOYEE
        employee.department_id = None
        db.add(employee)
        print(f"  Fixed: Employee {employee.employee_id} downgraded to EMPLOYEE")

    # STEP 4: Fix departments with broken HOD references
    print(f"\n[STEP 4] Fixing {len(broken_depts)} department(s) with broken references...")
    for dept, hod in broken_depts:
        dept.hod_id = None
        db.add(dept)
        print(f"  Fixed: Department '{dept.name}' HOD reference cleared")

    db.commit()
    print("\n[SUCCESS] All fixes applied!")

    # STEP 5: Verify consistency
    print("\n[VERIFICATION] Checking data consistency...")
    remaining_orphans = db.query(Employee).filter(
        and_(
            Employee.role == RoleEnum.HOD,
            or_(Employee.department_id == None, Employee.department_id == '')
        )
    ).count()

    all_hods = db.query(Employee).filter(Employee.role == RoleEnum.HOD).all()
    print(f"  Total HODs: {len(all_hods)}")
    print(f"  Orphaned HODs: {remaining_orphans}")

    if remaining_orphans == 0:
        print("\n[OK] Data is now consistent!")
    else:
        print(f"\n[WARNING] Still {remaining_orphans} orphaned HOD(s) found!")

    db.close()

except Exception as e:
    print(f"[ERROR] {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
