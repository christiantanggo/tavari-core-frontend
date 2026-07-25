-- Optional local time for child want requests (with event_date)

ALTER TABLE public.pullcoparent_child_wants
  ADD COLUMN IF NOT EXISTS event_time time;
