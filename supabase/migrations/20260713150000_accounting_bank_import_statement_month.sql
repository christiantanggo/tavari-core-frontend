-- Statement period for bank/CC CSV imports (first day of the statement month).
ALTER TABLE accounting_bank_imports
  ADD COLUMN IF NOT EXISTS statement_month DATE;

COMMENT ON COLUMN accounting_bank_imports.statement_month IS
  'First day of the calendar month this statement covers (e.g. 2026-05-01 for May 2026). Used to track month-end matching.';

CREATE INDEX IF NOT EXISTS idx_accounting_bank_imports_statement_month
  ON accounting_bank_imports (business_id, statement_month DESC NULLS LAST);
