-- Tracks shift reminder emails so we do not send duplicates when the dispatcher runs on a schedule.
CREATE TABLE IF NOT EXISTS public.scheduling_shift_reminder_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.scheduling_shifts (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  hours_before integer NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (shift_id, hours_before)
);

CREATE INDEX IF NOT EXISTS idx_shift_reminder_sent_shift ON public.scheduling_shift_reminder_sent (shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_reminder_sent_employee ON public.scheduling_shift_reminder_sent (employee_id);

ALTER TABLE public.scheduling_shift_reminder_sent ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.scheduling_shift_reminder_sent IS
  'Dedupe log for automated shift reminder emails (edge function uses service role).';
