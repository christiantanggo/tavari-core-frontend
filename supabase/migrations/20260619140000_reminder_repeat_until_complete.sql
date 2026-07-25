-- Tavari Reminder: automatically resend sent occurrences until they are completed.

ALTER TABLE public.tavari_reminders
  ADD COLUMN IF NOT EXISTS repeat_until_complete BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.tavari_reminders
  ADD COLUMN IF NOT EXISTS repeat_max INT CHECK (repeat_max IS NULL OR repeat_max >= 0);

COMMENT ON COLUMN public.tavari_reminders.repeat_until_complete IS
  'When true, a sent occurrence keeps resending on future days until completed.';

COMMENT ON COLUMN public.tavari_reminders.repeat_max IS
  'Maximum automatic repeats after the first send; NULL means unlimited.';

ALTER TABLE public.tavari_reminder_occurrences
  ADD COLUMN IF NOT EXISTS repeat_count INT NOT NULL DEFAULT 0;

ALTER TABLE public.tavari_reminder_occurrences
  ADD COLUMN IF NOT EXISTS next_repeat_at TIMESTAMPTZ;

COMMENT ON COLUMN public.tavari_reminder_occurrences.repeat_count IS
  'Automatic repeat sends after the initial send. User snoozes are tracked separately in snooze_count.';

COMMENT ON COLUMN public.tavari_reminder_occurrences.next_repeat_at IS
  'Next automatic resend time for sent-but-not-completed occurrences.';

CREATE INDEX IF NOT EXISTS idx_tavari_reminder_occurrences_repeat
  ON public.tavari_reminder_occurrences (status, next_repeat_at)
  WHERE status = 'sent';

-- Existing sent-but-uncompleted occurrences are intentionally not backfilled here.
-- New sends get next_repeat_at from reminder-dispatch using the business timezone,
-- holiday rules, and configured send time. Backfilling to now would resend old
-- reminders immediately when this migration is applied.
