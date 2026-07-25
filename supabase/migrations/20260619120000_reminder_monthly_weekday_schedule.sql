-- Tavari Reminder: nth weekday of month (e.g. first Monday)

ALTER TABLE public.tavari_reminders
  DROP CONSTRAINT IF EXISTS tavari_reminders_schedule_type_check;

ALTER TABLE public.tavari_reminders
  ADD CONSTRAINT tavari_reminders_schedule_type_check
  CHECK (schedule_type IN ('once', 'weekly', 'monthly', 'monthly_weekday'));

ALTER TABLE public.tavari_reminders
  ADD COLUMN IF NOT EXISTS schedule_week_of_month SMALLINT
  CHECK (schedule_week_of_month IS NULL OR (schedule_week_of_month >= 1 AND schedule_week_of_month <= 5));

COMMENT ON COLUMN public.tavari_reminders.schedule_week_of_month IS
  'For monthly_weekday: 1=first, 2=second, 3=third, 4=fourth, 5=last occurrence of schedule_day_of_week in the month';
