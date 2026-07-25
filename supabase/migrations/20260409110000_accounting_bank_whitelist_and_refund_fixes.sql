-- Accounting fixes:
-- 1) Move email sender whitelist onto accounting_business_config (current runtime source)
-- 2) Track which ERPNext bank account a bank import belongs to
-- 3) Store refund tax separately from gross refund amount in sales batches

ALTER TABLE accounting_business_config
  ADD COLUMN IF NOT EXISTS accounting_sender_whitelist TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  ADD COLUMN IF NOT EXISTS default_bank_account_erpnext TEXT;

COMMENT ON COLUMN accounting_business_config.accounting_sender_whitelist IS 'Exact sender email addresses allowed to create draft expenses via email.';
COMMENT ON COLUMN accounting_business_config.default_bank_account_erpnext IS 'Default ERPNext bank/cash ledger used when posting bank-imported expense payments.';

UPDATE accounting_business_config cfg
SET accounting_sender_whitelist = src.emails
FROM (
  SELECT
    business_id,
    ARRAY_AGG(lower(trim(email_address)) ORDER BY lower(trim(email_address))) AS emails
  FROM accounting_email_whitelist
  GROUP BY business_id
) AS src
WHERE src.business_id = cfg.business_id
  AND (
    cfg.accounting_sender_whitelist IS NULL
    OR cardinality(cfg.accounting_sender_whitelist) = 0
  );

ALTER TABLE accounting_bank_imports
  ADD COLUMN IF NOT EXISTS bank_account_erpnext TEXT;

COMMENT ON COLUMN accounting_bank_imports.bank_account_erpnext IS 'ERPNext bank/cash ledger account this import belongs to.';

ALTER TABLE accounting_sales_batches
  ADD COLUMN IF NOT EXISTS total_refund_tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN accounting_sales_batches.total_refund_tax_amount IS 'Tax portion of refunds in this batch so revenue and HST are reduced correctly when posting.';
