-- Policy Center "Deactivate" sets status to 'inactive'; original check only allowed
-- active, draft, archived, expired (see create_hr_policies_table.sql).

ALTER TABLE hr_policies DROP CONSTRAINT IF EXISTS hr_policies_status_check;

ALTER TABLE hr_policies ADD CONSTRAINT hr_policies_status_check
  CHECK (status IN ('active', 'draft', 'archived', 'expired', 'inactive'));
