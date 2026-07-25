-- Prune script and other clients use a DB role that respects RLS; there is no DELETE policy on
-- tavari_admin_security_logs, so plain DELETE returned 0 rows. This SECURITY DEFINER helper
-- runs as the function owner and removes old rows without opening broad DELETE policies.

CREATE OR REPLACE FUNCTION public.prune_security_logs_retention(
  retention_days integer DEFAULT 45,
  batch_limit integer DEFAULT 5000
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n bigint;
BEGIN
  IF retention_days < 1 OR retention_days > 3650 THEN
    RAISE EXCEPTION 'retention_days out of range (1–3650)';
  END IF;
  IF batch_limit < 1 OR batch_limit > 500000 THEN
    RAISE EXCEPTION 'batch_limit out of range (1–500000)';
  END IF;

  DELETE FROM public.tavari_admin_security_logs
  WHERE ctid IN (
    SELECT t.ctid
    FROM public.tavari_admin_security_logs AS t
    WHERE t.created_at < NOW() - (retention_days * INTERVAL '1 day')
    LIMIT batch_limit
  );

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

ALTER FUNCTION public.prune_security_logs_retention(integer, integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.prune_security_logs_retention(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_security_logs_retention(integer, integer) TO postgres;
