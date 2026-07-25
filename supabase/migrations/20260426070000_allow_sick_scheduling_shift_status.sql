ALTER TABLE public.scheduling_shifts
  DROP CONSTRAINT IF EXISTS scheduling_shifts_status_check;

ALTER TABLE public.scheduling_shifts
  ADD CONSTRAINT scheduling_shifts_status_check
  CHECK (status = ANY (ARRAY[
    'scheduled'::text,
    'confirmed'::text,
    'clocked_in'::text,
    'completed'::text,
    'no_show'::text,
    'cancelled'::text,
    'sick'::text
  ]));
