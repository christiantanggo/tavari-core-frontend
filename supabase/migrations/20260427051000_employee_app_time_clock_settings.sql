ALTER TABLE public.scheduling_settings
  ADD COLUMN IF NOT EXISTS time_clock_geofence_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS time_clock_geofence_latitude numeric(10, 8),
  ADD COLUMN IF NOT EXISTS time_clock_geofence_longitude numeric(11, 8),
  ADD COLUMN IF NOT EXISTS time_clock_geofence_radius_meters integer NOT NULL DEFAULT 150,
  ADD COLUMN IF NOT EXISTS time_clock_late_grace_minutes integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS time_clock_early_clock_out_grace_minutes integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS allow_employee_app_unscheduled_clock_in boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.scheduling_settings.time_clock_geofence_enabled IS 'When true, employee app clock-in/out requires GPS within the configured geofence.';
COMMENT ON COLUMN public.scheduling_settings.time_clock_geofence_latitude IS 'Latitude for employee app time clock geofence center.';
COMMENT ON COLUMN public.scheduling_settings.time_clock_geofence_longitude IS 'Longitude for employee app time clock geofence center.';
COMMENT ON COLUMN public.scheduling_settings.time_clock_geofence_radius_meters IS 'Allowed radius in meters for employee app time clock geofence.';
COMMENT ON COLUMN public.scheduling_settings.time_clock_late_grace_minutes IS 'Minutes after scheduled start before a clock-in is considered late.';
COMMENT ON COLUMN public.scheduling_settings.time_clock_early_clock_out_grace_minutes IS 'Minutes before scheduled end before a clock-out is considered early.';
COMMENT ON COLUMN public.scheduling_settings.allow_employee_app_unscheduled_clock_in IS 'When false, employees must select a scheduled shift to clock in from the employee app.';
