#!/usr/bin/env bash
# Quick SQL fix for HODs without departments

echo "Fixing HODs without department assignment..."
psql -U postgres -d anix_hrms << EOF
-- Show HODs without departments before fix
SELECT 'BEFORE FIX:' as status, employee_id, CONCAT(first_name, ' ', last_name) as name, role, department_id
FROM employees
WHERE role = 'HOD' AND department_id IS NULL;

-- Fix: Downgrade HODs without departments to EMPLOYEE
UPDATE employees
SET role = 'EMPLOYEE'
WHERE role = 'HOD' AND department_id IS NULL;

-- Show result after fix
SELECT 'AFTER FIX:' as status, employee_id, CONCAT(first_name, ' ', last_name) as name, role, department_id
FROM employees
WHERE employee_id IN (10003, 10011)
ORDER BY employee_id;

SELECT '✓ Fixed. All HODs now have departments.' as result;
EOF
