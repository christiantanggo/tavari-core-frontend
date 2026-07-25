-- Tavari Reminder: bi-weekly (every 2 weeks on a weekday; anchor = first matching weekday on/after starts_on)

ALTER TABLE public.tavari_reminders
  DROP CONSTRAINT IF EXISTS tavari_reminders_schedule_type_check;

ALTER TABLE public.tavari_reminders
  ADD CONSTRAINT tavari_reminders_schedule_type_check
  CHECK (schedule_type IN ('once', 'weekly', 'biweekly', 'monthly', 'monthly_weekday'));
