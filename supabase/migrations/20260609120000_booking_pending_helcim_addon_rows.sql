-- Store portal-selected party/activity options on pending checkout for finalization.

ALTER TABLE public.booking_pending_helcim
  ADD COLUMN IF NOT EXISTS addon_rows JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.booking_pending_helcim.addon_rows IS
  'Portal option line items selected before payment: option_id, name, quantity, unit_price.';
