-- Tavari Reminder: quarterly (every 3 months on day of month; anchor = starts_on month)

ALTER TABLE public.tavari_reminders
  DROP CONSTRAINT IF EXISTS tavari_reminders_schedule_type_check;

ALTER TABLE public.tavari_reminders
  ADD CONSTRAINT tavari_reminders_schedule_type_check
  CHECK (schedule_type IN ('once', 'weekly', 'biweekly', 'monthly', 'monthly_weekday', 'quarterly'));
