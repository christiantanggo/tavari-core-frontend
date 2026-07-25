-- Enable live sync when either parent edits calendar event types.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'pullcoparent_event_types'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pullcoparent_event_types;
  END IF;
END $$;
