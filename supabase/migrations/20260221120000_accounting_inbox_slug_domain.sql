-- Generic per-business accounting inbox: [slug]@[domain] (e.g. acme@tavarios.ca).
-- When set, the derived address is used for routing and accounting inbox checks.
-- Legacy {business_id}@tavarios.ca routing remains supported separately in receive-email.

ALTER TABLE accounting_business_config
  ADD COLUMN IF NOT EXISTS accounting_inbox_domain TEXT DEFAULT 'tavarios.ca',
  ADD COLUMN IF NOT EXISTS accounting_inbox_slug TEXT;

COMMENT ON COLUMN accounting_business_config.accounting_inbox_domain IS 'Domain for accounting inbox (e.g. tavarios.ca). With accounting_inbox_slug, derived address is slug@domain.';
COMMENT ON COLUMN accounting_business_config.accounting_inbox_slug IS 'Local part for accounting inbox (e.g. acme). Unique per domain; derived address is slug@accounting_inbox_domain.';

-- One (domain, slug) pair maps to one business
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_inbox_domain_slug
  ON accounting_business_config (lower(trim(accounting_inbox_domain)), lower(trim(accounting_inbox_slug)))
  WHERE accounting_inbox_domain IS NOT NULL AND accounting_inbox_slug IS NOT NULL AND trim(accounting_inbox_slug) <> '';
