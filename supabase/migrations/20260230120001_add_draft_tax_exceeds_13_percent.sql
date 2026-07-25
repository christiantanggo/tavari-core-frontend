-- Flag when extracted/calculated tax is over 13% of subtotal/total so it is flagged for verification (same as hst_calculated).
ALTER TABLE accounting_draft_expenses
  ADD COLUMN IF NOT EXISTS tax_exceeds_13_percent BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN accounting_draft_expenses.tax_exceeds_13_percent IS 'True when tax amount exceeds 13% of subtotal (or total). Queue shows verify warning and flags for approval.';
