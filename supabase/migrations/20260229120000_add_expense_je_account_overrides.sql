-- Optional overrides for expense Journal Entry account base names (suffix " - {abbr}" is always appended).
-- Use when your ERPNext Chart uses different names (e.g. "HST" instead of "HST Recoverable").
ALTER TABLE accounting_business_config
  ADD COLUMN IF NOT EXISTS hst_recoverable_account_erpnext TEXT,
  ADD COLUMN IF NOT EXISTS accounts_payable_account_erpnext TEXT;

COMMENT ON COLUMN accounting_business_config.hst_recoverable_account_erpnext IS 'Base account name for HST recoverable (ITC) in expense JEs. Default: HST Recoverable. Suffix " - {abbr}" is appended.';
COMMENT ON COLUMN accounting_business_config.accounts_payable_account_erpnext IS 'Base account name for Accounts Payable in expense JEs. Default: Accounts Payable. Suffix " - {abbr}" is appended.';
