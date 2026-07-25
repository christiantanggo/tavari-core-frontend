-- Keep public.tavari_admin_security_logs for 45 days, then delete automatically.
-- VACUUM cannot run inside PL/pgSQL; a separate pg_cron job runs VACUUM ANALYZE after the daily delete window.

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.cleanup_old_security_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.tavari_admin_security_logs
  WHERE created_at < NOW() - INTERVAL '45 days';
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_security_logs() FROM PUBLIC;

-- Daily delete (UTC 05:00), then vacuum analyze same morning (UTC 05:30) so dead space is reclaimed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'security-logs-delete-older-than-45d') THEN
    PERFORM cron.unschedule('security-logs-delete-older-than-45d');
  END IF;

  PERFORM cron.schedule(
    'security-logs-delete-older-than-45d',
    '0 5 * * *',
    'SELECT public.cleanup_old_security_logs();'
  );
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'security-logs-vacuum-analyze') THEN
    PERFORM cron.unschedule('security-logs-vacuum-analyze');
  END IF;

  PERFORM cron.schedule(
    'security-logs-vacuum-analyze',
    '30 5 * * *',
    'VACUUM ANALYZE public.tavari_admin_security_logs;'
  );
END $$;
