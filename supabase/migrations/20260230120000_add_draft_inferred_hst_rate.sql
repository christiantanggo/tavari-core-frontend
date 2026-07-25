-- Store tax rate inferred from invoice (e.g. 0.13 for Ontario HST) so we use HST not GST when appropriate.
ALTER TABLE accounting_draft_expenses
  ADD COLUMN IF NOT EXISTS inferred_hst_rate NUMERIC(5,4) NULL;

COMMENT ON COLUMN accounting_draft_expenses.inferred_hst_rate IS 'Tax rate inferred from invoice (e.g. 0.13 for ON HST, 0.05 for GST). Used for display and back-calculation when vendor default would be wrong.';
