-- Optional default GL accounts for depreciation (used when asset does not specify its own).
ALTER TABLE accounting_business_config
  ADD COLUMN IF NOT EXISTS depreciation_expense_account_erpnext TEXT,
  ADD COLUMN IF NOT EXISTS accumulated_depreciation_account_erpnext TEXT;
