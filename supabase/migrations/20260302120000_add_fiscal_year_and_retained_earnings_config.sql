-- Fiscal year end and retained earnings for year-end close and reports.

ALTER TABLE accounting_business_config
  ADD COLUMN IF NOT EXISTS fiscal_year_end_month SMALLINT DEFAULT 12,
  ADD COLUMN IF NOT EXISTS fiscal_year_end_day SMALLINT DEFAULT 31,
  ADD COLUMN IF NOT EXISTS retained_earnings_account_erpnext TEXT;

COMMENT ON COLUMN accounting_business_config.fiscal_year_end_month IS 'Fiscal year end month (1-12). Default 12 = calendar year.';
COMMENT ON COLUMN accounting_business_config.fiscal_year_end_day IS 'Fiscal year end day (1-31).';
COMMENT ON COLUMN accounting_business_config.retained_earnings_account_erpnext IS 'ERPNext account name for Retained Earnings (year-end closing entry).';
