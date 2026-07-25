-- Add revised_date to hr_policies for policy editor and document display
ALTER TABLE hr_policies
  ADD COLUMN IF NOT EXISTS revised_date DATE;

COMMENT ON COLUMN hr_policies.revised_date IS 'Date the policy was last revised; shown on policy document below effective date.';
