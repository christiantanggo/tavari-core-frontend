-- Waiver kiosk idle content uses the same schedule + playlist model as digital signage.

ALTER TABLE public.digital_signage_schedules
  DROP CONSTRAINT IF EXISTS digital_signage_schedules_schedule_type_check;

ALTER TABLE public.digital_signage_schedules
  ADD CONSTRAINT digital_signage_schedules_schedule_type_check
  CHECK (schedule_type IN ('playlist', 'time_based', 'event_based', 'waiver_kiosk'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_digital_signage_schedules_waiver_kiosk_per_business
  ON public.digital_signage_schedules (business_id)
  WHERE schedule_type = 'waiver_kiosk' AND is_active = true;

COMMENT ON INDEX public.idx_digital_signage_schedules_waiver_kiosk_per_business IS
  'One active Waiver Kiosks schedule per business (auto-created by the app).';
