-- Invoice date (date on the invoice document) can differ from transaction_date (payment/bank date).
ALTER TABLE accounting_draft_expenses
  ADD COLUMN IF NOT EXISTS invoice_date DATE;

COMMENT ON COLUMN accounting_draft_expenses.invoice_date IS 'Date on the invoice document; may differ from transaction_date (payment/bank date).';
