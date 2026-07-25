-- Employee app / portal: rear-facing "workplace" snapshot taken immediately after selfie at punch time
ALTER TABLE public.scheduling_time_clocks
  ADD COLUMN IF NOT EXISTS clock_in_environment_photo_url text,
  ADD COLUMN IF NOT EXISTS clock_out_environment_photo_url text;

COMMENT ON COLUMN public.scheduling_time_clocks.clock_in_environment_photo_url IS 'Rear-camera workplace photo URL at clock-in (employee app)';
COMMENT ON COLUMN public.scheduling_time_clocks.clock_out_environment_photo_url IS 'Rear-camera workplace photo URL at clock-out (employee app)';
