-- Parking-lot status for expense drafts waiting on CAD, docs, or other info.
ALTER TABLE accounting_draft_expenses
  DROP CONSTRAINT IF EXISTS accounting_draft_expenses_status_check;

ALTER TABLE accounting_draft_expenses
  ADD CONSTRAINT accounting_draft_expenses_status_check
  CHECK (status IN ('draft', 'on_hold', 'approved', 'posting', 'posted'));
