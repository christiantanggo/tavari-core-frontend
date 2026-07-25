ALTER TABLE accounting_business_config
  ADD COLUMN IF NOT EXISTS accounting_sender_whitelist TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

COMMENT ON COLUMN accounting_business_config.accounting_sender_whitelist IS 'Exact sender email addresses allowed to create draft expenses via email. Only these from_addresses are processed.';
