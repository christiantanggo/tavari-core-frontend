-- Which balance-sheet account an expense credits: AP (unpaid) vs cash-on-hand / bank / clearing.
ALTER TABLE accounting_draft_expenses
  ADD COLUMN IF NOT EXISTS credit_account_erpnext TEXT;

COMMENT ON COLUMN accounting_draft_expenses.credit_account_erpnext IS
  'Logical ERPNext account the expense is assigned to (credit side). NULL/empty = Accounts Payable (unpaid). Cash on hand, bank, or clearing accounts post a payment/clearing entry against that account.';
