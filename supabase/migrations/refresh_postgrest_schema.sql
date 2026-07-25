-- Force PostgREST to refresh schema cache
-- Run this after creating/updating functions to ensure they're available via RPC

NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

-- Also try alternative method
DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
END $$;








