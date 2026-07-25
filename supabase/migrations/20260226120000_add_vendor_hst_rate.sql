-- Add default HST rate to vendors. When HST is not found in invoice extraction,
-- we use this rate to back-calculate HST from total (assuming HST is included).
-- Rate as decimal: 0.13 = 13%, 0.05 = 5% GST, 0 = exempt.
ALTER TABLE accounting_vendors
  ADD COLUMN IF NOT EXISTS default_hst_rate NUMERIC(5,4);

COMMENT ON COLUMN accounting_vendors.default_hst_rate IS 'HST/GST rate as decimal (e.g. 0.13 for 13%). Used to calculate HST from total when not found in invoice.';
