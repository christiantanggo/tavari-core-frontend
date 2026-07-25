-- Staff override audit when booking outside business / holiday hours (manager PIN approved).

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS business_hours_override_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS business_hours_override_at TIMESTAMPTZ;

COMMENT ON COLUMN public.bookings.business_hours_override_by IS
  'Manager/owner/admin who approved booking outside configured business hours.';
COMMENT ON COLUMN public.bookings.business_hours_override_at IS
  'When the outside-hours manager override was approved.';
