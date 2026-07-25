-- Time-of-day rules and stacking metadata for hr_shift_premiums.
-- Payroll/scheduling engines can read these columns when attributing premium hours.

ALTER TABLE public.hr_shift_premiums
  ADD COLUMN IF NOT EXISTS time_application_mode text NOT NULL DEFAULT 'none'
    CHECK (time_application_mode IN (
      'none',
      'daily_window',
      'public_hours_inside_buffer',
      'public_hours_outside_buffer'
    )),
  ADD COLUMN IF NOT EXISTS daily_window_start time without time zone NULL,
  ADD COLUMN IF NOT EXISTS daily_window_end time without time zone NULL,
  ADD COLUMN IF NOT EXISTS public_hours_buffer_before_minutes integer NOT NULL DEFAULT 60
    CHECK (public_hours_buffer_before_minutes >= 0 AND public_hours_buffer_before_minutes <= 24 * 60),
  ADD COLUMN IF NOT EXISTS public_hours_buffer_after_minutes integer NOT NULL DEFAULT 60
    CHECK (public_hours_buffer_after_minutes >= 0 AND public_hours_buffer_after_minutes <= 24 * 60),
  ADD COLUMN IF NOT EXISTS stacking_behavior text NOT NULL DEFAULT 'additive'
    CHECK (stacking_behavior IN ('additive', 'exclusive_cluster')),
  ADD COLUMN IF NOT EXISTS exclusive_cluster_key text NULL;

COMMENT ON COLUMN public.hr_shift_premiums.time_application_mode IS
  'none: no clock filter. daily_window: premium applies when local time is inside daily_window_start/end each day (if start > end, window crosses midnight). public_hours_inside_buffer: during businesses.operating_hours expanded by buffer minutes. public_hours_outside_buffer: inverse of that expanded window.';
COMMENT ON COLUMN public.hr_shift_premiums.exclusive_cluster_key IS
  'When stacking_behavior = exclusive_cluster, at most one premium with the same non-null key should apply per hour; additive premiums stack with all.';
