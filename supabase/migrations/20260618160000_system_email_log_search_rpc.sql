-- Email History search: avoid PostgREST OR+ilike timeouts and broken parsing on emails with dots.
-- Applies pg_trgm indexes (if missing) and a server-side search RPC.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_system_email_log_subject_gin_trgm
  ON public.system_email_log USING gin (subject gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_system_email_log_from_email_gin_trgm
  ON public.system_email_log USING gin (from_email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_system_email_log_recipient_email_gin_trgm
  ON public.system_email_log USING gin (recipient_email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_system_email_log_source_module_gin_trgm
  ON public.system_email_log USING gin (source_module gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.search_system_email_log(
  p_business_id uuid,
  p_search text DEFAULT NULL,
  p_email_type text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_source_module text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS SETOF public.system_email_log
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_search text;
  v_pattern text;
  v_limit integer;
  v_offset integer;
BEGIN
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
  v_offset := GREATEST(0, COALESCE(p_offset, 0));
  v_search := NULLIF(btrim(COALESCE(p_search, '')), '');

  IF v_search IS NOT NULL THEN
    v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  RETURN QUERY
  SELECT sel.*
  FROM public.system_email_log sel
  WHERE sel.business_id = p_business_id
    AND (
      p_email_type IS NULL
      OR btrim(p_email_type) = ''
      OR p_email_type = 'all'
      OR sel.email_type = p_email_type
    )
    AND (
      p_status IS NULL
      OR btrim(p_status) = ''
      OR p_status = 'all'
      OR sel.status = p_status
    )
    AND (
      p_source_module IS NULL
      OR btrim(p_source_module) = ''
      OR p_source_module = 'all'
      OR sel.source_module = p_source_module
    )
    AND (
      v_pattern IS NULL
      OR (
        CASE
          WHEN position('@' IN v_search) > 0 THEN
            sel.from_email ILIKE v_pattern ESCAPE '\'
            OR sel.recipient_email ILIKE v_pattern ESCAPE '\'
            OR lower(sel.from_email) = lower(v_search)
            OR lower(sel.recipient_email) = lower(v_search)
          ELSE
            sel.subject ILIKE v_pattern ESCAPE '\'
            OR sel.from_email ILIKE v_pattern ESCAPE '\'
            OR sel.source_module ILIKE v_pattern ESCAPE '\'
            OR sel.recipient_email ILIKE v_pattern ESCAPE '\'
        END
      )
    )
  ORDER BY sel.created_at DESC
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.search_system_email_log(uuid, text, text, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_system_email_log(uuid, text, text, text, text, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.search_system_email_log(uuid, text, text, text, text, integer, integer) IS
  'Paginated email history search for a business. Used by Inbox Email History UI.';
