#!/usr/bin/env python
"""
Fix HODs without department assignment.
Downgrades any HOD that doesn't have a department_id to EMPLOYEE role.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from app.core.database import SessionLocal
from app.models.employee import Employee, RoleEnum
from sqlalchemy import and_

db = SessionLocal()

try:
    # Find all HODs without a department
    hods_without_dept = db.query(Employee).filter(
        and_(
            Employee.role == RoleEnum.HOD,
            Employee.department_id == None
        )
    ).all()

    if not hods_without_dept:
        print("✓ No HODs without departments found. Data is consistent!")
        sys.exit(0)

    print(f"Found {len(hods_without_dept)} HOD(s) without department:")
    for employee in hods_without_dept:
        print(f"  - Employee ID {employee.employee_id}: {employee.first_name} {employee.last_name} (Role: {employee.role})")

    # Fix them
    fixed_count = 0
    for employee in hods_without_dept:
        employee.role = RoleEnum.EMPLOYEE
        db.add(employee)
        fixed_count += 1
        print(f"  ✓ Downgraded Employee {employee.employee_id} from HOD to EMPLOYEE")

    db.commit()
    print(f"\n✓ Successfully fixed {fixed_count} employee(s)")

finally:
    db.close()
