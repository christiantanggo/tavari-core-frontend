-- Control whether an activity appears on the customer booking site (portal).
-- Staff can still book portal_visible = false activities (e.g. legacy Bookeo import tiers).

ALTER TABLE public.booking_activities
  ADD COLUMN IF NOT EXISTS portal_visible BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.booking_activities.portal_visible IS
  'When false, activity is hidden from the customer booking portal but remains available to staff.';

CREATE INDEX IF NOT EXISTS idx_booking_activities_portal_visible
  ON public.booking_activities (business_id, portal_visible)
  WHERE is_active = true AND portal_visible = true;
