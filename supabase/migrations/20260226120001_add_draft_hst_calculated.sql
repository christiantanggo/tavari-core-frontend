-- Flag to indicate HST was calculated from vendor rate (not extracted from invoice).
-- Queue highlights HST amount when true so user verifies before approval.
ALTER TABLE accounting_draft_expenses
  ADD COLUMN IF NOT EXISTS hst_calculated BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN accounting_draft_expenses.hst_calculated IS 'True when HST was back-calculated from vendor rate (total / (1+rate)) because extraction did not find it. Queue highlights HST for user verification.';
