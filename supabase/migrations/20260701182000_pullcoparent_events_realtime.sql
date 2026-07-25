-- Live badge updates for today's calendar events

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'pullcoparent_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pullcoparent_events;
  END IF;
END $$;
