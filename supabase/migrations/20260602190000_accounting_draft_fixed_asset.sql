-- Link queue expenses to fixed assets when a purchase is capitalized.

ALTER TABLE accounting_draft_expenses
  ADD COLUMN IF NOT EXISTS is_fixed_asset BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS asset_name TEXT,
  ADD COLUMN IF NOT EXISTS asset_useful_life_years NUMERIC(6, 2) DEFAULT 5,
  ADD COLUMN IF NOT EXISTS asset_salvage_value NUMERIC(14, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS asset_gl_account_erpnext TEXT,
  ADD COLUMN IF NOT EXISTS fixed_asset_id UUID REFERENCES accounting_fixed_assets(id) ON DELETE SET NULL;

COMMENT ON COLUMN accounting_draft_expenses.is_fixed_asset IS 'When true, posting creates a row on accounting_fixed_assets and debits a fixed-asset GL account.';
COMMENT ON COLUMN accounting_draft_expenses.asset_gl_account_erpnext IS 'ERPNext fixed-asset account base name (suffix added at post). Falls back to gl_account_erpnext.';

ALTER TABLE accounting_fixed_assets
  ADD COLUMN IF NOT EXISTS draft_expense_id UUID REFERENCES accounting_draft_expenses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS erpnext_purchase_invoice_id TEXT;

CREATE INDEX IF NOT EXISTS idx_accounting_fixed_assets_draft_expense
  ON accounting_fixed_assets(draft_expense_id)
  WHERE draft_expense_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounting_draft_expenses_fixed_asset
  ON accounting_draft_expenses(fixed_asset_id)
  WHERE fixed_asset_id IS NOT NULL;
