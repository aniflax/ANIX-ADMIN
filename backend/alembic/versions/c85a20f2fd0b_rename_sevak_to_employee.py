"""rename sevak to employee

Renames the domain entity "Sevak" to "Employee" across the schema: tables,
the sevak_id columns, the SEVAK role enum value, related constraint/index
names and the SEVAK_ID_* system_config keys.

Historical migrations are intentionally left untouched — they build the old
"sevak" schema and this migration renames it forward, so a fresh
`alembic upgrade head` ends up in exactly the same state.

Revision ID: c85a20f2fd0b
Revises: z1_backfill_ist
Create Date: 2026-09-17 16:55:17.325562

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c85a20f2fd0b'
down_revision: Union[str, Sequence[str], None] = 'z1_backfill_ist'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLES = [
    ("sevaks", "employees"),
    ("sevak_locations", "employee_locations"),
    ("sevak_week_off_history", "employee_week_off_history"),
]

# Every table carrying a sevak_id column. Ordered old-name-first for upgrade.
COLUMN_TABLES = [
    "account_events",
    "attendance_logs",
    "leave_balances",
    "leave_requests",
    "sevak_locations",
    "sevak_week_off_history",
    "sevaks",
]


def _rename_constraints(old: str, new: str) -> None:
    """Rewrite every constraint/index name containing `old` to use `new`.

    Constraint renames happen first (Postgres renames the backing index for
    primary/unique constraints automatically); the index loop then skips any
    index owned by a constraint so nothing is renamed twice.
    """
    op.execute(
        f"""
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname, conrelid::regclass::text AS tbl
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace AND conname LIKE '%{old}%'
  LOOP
    EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I',
                   r.tbl, r.conname, replace(r.conname, '{old}', '{new}'));
  END LOOP;

  FOR r IN
    SELECT i.indexname
    FROM pg_indexes i
    WHERE i.schemaname = 'public'
      AND i.indexname LIKE '%{old}%'
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = i.indexname
          AND c.connamespace = 'public'::regnamespace
      )
  LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I',
                   r.indexname, replace(r.indexname, '{old}', '{new}'));
  END LOOP;
END $$;
"""
    )


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("ALTER TYPE roleenum RENAME VALUE 'SEVAK' TO 'EMPLOYEE'")

    op.execute("UPDATE system_config SET key = 'EMPLOYEE_ID_START' WHERE key = 'SEVAK_ID_START'")
    op.execute(
        "UPDATE system_config SET key = 'EMPLOYEE_ID_FORMAT_DIGITS' "
        "WHERE key = 'SEVAK_ID_FORMAT_DIGITS'"
    )
    op.execute(
        "UPDATE system_config SET description = replace(description, 'Sevak', 'Employee') "
        "WHERE description LIKE '%Sevak%'"
    )

    for table in COLUMN_TABLES:
        op.alter_column(table, "sevak_id", new_column_name="employee_id")

    for old, new in TABLES:
        op.rename_table(old, new)

    _rename_constraints("sevak", "employee")


def downgrade() -> None:
    """Downgrade schema."""
    _rename_constraints("employee", "sevak")

    for old, new in TABLES:
        op.rename_table(new, old)

    for table in COLUMN_TABLES:
        op.alter_column(table, "employee_id", new_column_name="sevak_id")

    op.execute("UPDATE system_config SET key = 'SEVAK_ID_START' WHERE key = 'EMPLOYEE_ID_START'")
    op.execute(
        "UPDATE system_config SET key = 'SEVAK_ID_FORMAT_DIGITS' "
        "WHERE key = 'EMPLOYEE_ID_FORMAT_DIGITS'"
    )
    op.execute(
        "UPDATE system_config SET description = replace(description, 'Employee', 'Sevak') "
        "WHERE description LIKE '%Employee%'"
    )

    op.execute("ALTER TYPE roleenum RENAME VALUE 'EMPLOYEE' TO 'SEVAK'")
