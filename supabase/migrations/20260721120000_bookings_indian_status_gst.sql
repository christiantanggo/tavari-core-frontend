-- Indian Status (GST-only) for bookings — mirrors POS indian status fields on pos_sales

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS indian_status_gst_only boolean NOT NULL DEFAULT false;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS indian_status_certificate_number text;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS indian_status_restore_order_total numeric;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS indian_status_restore_tax_amount numeric;

COMMENT ON COLUMN public.bookings.indian_status_gst_only IS 'When true, booking tax uses GST-only rate from pos_settings (Indian Status)';
COMMENT ON COLUMN public.bookings.indian_status_certificate_number IS 'Certificate / registry number entered for Indian Status on this booking';
COMMENT ON COLUMN public.bookings.indian_status_restore_order_total IS 'Baseline order_total before Indian Status was applied (for restore on remove)';
COMMENT ON COLUMN public.bookings.indian_status_restore_tax_amount IS 'Baseline tax_amount before Indian Status was applied (for restore on remove)';
