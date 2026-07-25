-- When extraction has run (success or fail), set extraction_completed_at so the Queue
-- can stop showing "Extracting..." and show the draft row (even if amount is 0).
ALTER TABLE accounting_draft_expenses
  ADD COLUMN IF NOT EXISTS extraction_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN accounting_draft_expenses.extraction_completed_at IS 'Set when accounting-extract-draft-expense has run for this draft (email source). Used by Queue to show row instead of loading spinner.';

-- Backfill existing email drafts so they show as completed (no spinner).
UPDATE accounting_draft_expenses
SET extraction_completed_at = updated_at
WHERE source = 'email' AND extraction_completed_at IS NULL;
