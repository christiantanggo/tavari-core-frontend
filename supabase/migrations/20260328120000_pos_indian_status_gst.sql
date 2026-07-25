-- Indian Status (GST-only) POS: configurable rate, sale/receipt flags and certificate number

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS indian_status_gst_rate numeric NOT NULL DEFAULT 0.05;

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS indian_status_tax_label text NOT NULL DEFAULT 'GST (Indian Status)';

ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS indian_status_gst_only boolean NOT NULL DEFAULT false;

ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS indian_status_certificate_number text;

ALTER TABLE pos_receipts
  ADD COLUMN IF NOT EXISTS indian_status_gst_only boolean NOT NULL DEFAULT false;

ALTER TABLE pos_receipts
  ADD COLUMN IF NOT EXISTS indian_status_certificate_number text;

COMMENT ON COLUMN pos_settings.indian_status_gst_rate IS 'Federal GST rate (decimal) applied for Indian Status (GST-only) transactions, e.g. 0.05 for 5%';
COMMENT ON COLUMN pos_sales.indian_status_gst_only IS 'When true, sale was taxed at GST-only rate for Indian Status';
COMMENT ON COLUMN pos_sales.indian_status_certificate_number IS 'Certificate / registry number entered at POS for Indian Status';
