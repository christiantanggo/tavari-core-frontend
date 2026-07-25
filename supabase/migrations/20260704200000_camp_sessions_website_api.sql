-- Website-oriented camp session calendar (tavari-api-camp-sessions).

ALTER TABLE public.booking_activities
  ADD COLUMN IF NOT EXISTS website_show_camp_sessions BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS website_camp_program TEXT,
  ADD COLUMN IF NOT EXISTS website_camp_age_min INT,
  ADD COLUMN IF NOT EXISTS website_camp_age_max INT,
  ADD COLUMN IF NOT EXISTS website_camp_schedule_summary TEXT;

COMMENT ON COLUMN public.booking_activities.website_show_camp_sessions IS
  'When true, scheduled sessions for this activity are returned by tavari-api-camp-sessions.';
COMMENT ON COLUMN public.booking_activities.website_camp_program IS
  'Camp program key for website filtering: pa_day, summer_single, summer_week, march_break, winter_break.';
COMMENT ON COLUMN public.booking_activities.website_camp_age_min IS
  'Minimum camper age for website camp session display.';
COMMENT ON COLUMN public.booking_activities.website_camp_age_max IS
  'Maximum camper age for website camp session display.';
COMMENT ON COLUMN public.booking_activities.website_camp_schedule_summary IS
  'Optional daily schedule summary for website (e.g. 8:30am–4:30pm full day with lunch & snacks).';

CREATE INDEX IF NOT EXISTS idx_booking_activities_website_camp_sessions
  ON public.booking_activities (business_id, website_camp_program)
  WHERE website_show_camp_sessions = true AND is_active = true;
