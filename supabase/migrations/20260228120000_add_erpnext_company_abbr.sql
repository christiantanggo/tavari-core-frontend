-- ERPNext uses full account names like "Cost of Goods Sold - TOS". Store company abbreviation for Journal Entry API.
ALTER TABLE accounting_business_config
  ADD COLUMN IF NOT EXISTS erpnext_company_abbr TEXT;

COMMENT ON COLUMN accounting_business_config.erpnext_company_abbr IS 'Company abbreviation in ERPNext (e.g. TOS for Tavari OS). Required for Journal Entry account names.';
