-- Per-activity: show Terms & Conditions CTA on the booking confirmation page
-- (post-booking acknowledgment / party approval flow).

ALTER TABLE public.booking_activities
  ADD COLUMN IF NOT EXISTS terms_show_on_confirmation BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.booking_activities.terms_show_on_confirmation IS
  'When true and a terms_package_id is set, new bookings get pending T&Cs and the customer confirmation page shows the acknowledgment CTA.';

CREATE INDEX IF NOT EXISTS idx_booking_activities_terms_on_confirmation
  ON public.booking_activities (business_id)
  WHERE terms_show_on_confirmation = true;
