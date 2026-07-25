-- Dashboard search for imported legacy / Smartwaiver / Wallkids rows.
-- Default excludes archived; p_include_archived=true when staff checks "Include archived" on search.

CREATE OR REPLACE FUNCTION public.waivers_escape_ilike_pattern(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT replace(replace(replace(coalesce(p, ''), '\', '\\'), '%', '\%'), '_', '\_');
$$;

CREATE OR REPLACE FUNCTION public.waivers_search_legacy_waivers(
  p_business_id uuid,
  p_search text,
  p_limit integer DEFAULT 500,
  p_include_archived boolean DEFAULT false
)
RETURNS SETOF public.legacy_waivers
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw text := trim(coalesce(p_search, ''));
  v_pat text;
  v_digits text;
  v_lim integer := LEAST(GREATEST(coalesce(p_limit, 500), 1), 500);
  v_last text;
  v_first_initial text;
BEGIN
  IF p_business_id IS NULL OR length(v_raw) < 1 THEN
    RETURN;
  END IF;

  IF auth.uid() IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = p_business_id AND bu.user_id = auth.uid()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.business_id = p_business_id AND ur.user_id = auth.uid() AND ur.active = true
    )
  THEN
    RETURN;
  END IF;

  v_pat := public.waivers_escape_ilike_pattern(v_raw);
  v_digits := regexp_replace(v_raw, '[^0-9]', '', 'g');

  IF position(' ' in v_raw) > 0 THEN
    v_last := public.waivers_escape_ilike_pattern(split_part(v_raw, ' ', 1));
    v_first_initial := public.waivers_escape_ilike_pattern(split_part(v_raw, ' ', 2));
    IF length(v_first_initial) = 1 THEN
      RETURN QUERY
      SELECT lw.*
      FROM public.legacy_waivers lw
      WHERE lw.business_id = p_business_id
        AND lw.deleted_at IS NULL
        AND (p_include_archived OR lw.archived_at IS NULL)
        AND lw.last_name ILIKE '%' || v_last || '%' ESCAPE '\'
        AND lw.first_name ILIKE v_first_initial || '%' ESCAPE '\'
      ORDER BY lw.signed_at DESC NULLS LAST, lw.created_at DESC NULLS LAST
      LIMIT v_lim;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  SELECT lw.*
  FROM public.legacy_waivers lw
  WHERE lw.business_id = p_business_id
    AND lw.deleted_at IS NULL
    AND (p_include_archived OR lw.archived_at IS NULL)
    AND (
      lw.first_name ILIKE '%' || v_pat || '%' ESCAPE '\'
      OR lw.last_name ILIKE '%' || v_pat || '%' ESCAPE '\'
      OR (lw.first_name || ' ' || lw.last_name) ILIKE '%' || v_pat || '%' ESCAPE '\'
      OR (lw.last_name || ' ' || lw.first_name) ILIKE '%' || v_pat || '%' ESCAPE '\'
      OR coalesce(lw.email, '') ILIKE '%' || v_pat || '%' ESCAPE '\'
      OR coalesce(lw.phone, '') ILIKE '%' || v_pat || '%' ESCAPE '\'
      OR coalesce(lw.external_document_id, '') ILIKE '%' || v_pat || '%' ESCAPE '\'
      OR coalesce(lw.notes, '') ILIKE '%' || v_pat || '%' ESCAPE '\'
      OR coalesce(lw.info, '') ILIKE '%' || v_pat || '%' ESCAPE '\'
      OR coalesce(lw.legacy_minors::text, '') ILIKE '%' || v_pat || '%' ESCAPE '\'
      OR (
        length(v_digits) >= 3
        AND regexp_replace(coalesce(lw.phone, ''), '[^0-9]', '', 'g') LIKE '%' || v_digits || '%'
      )
      OR (
        length(v_digits) >= 1
        AND lw.legacy_row_id IS NOT NULL
        AND lw.legacy_row_id::text LIKE '%' || v_digits || '%'
      )
    )
  ORDER BY lw.signed_at DESC NULLS LAST, lw.created_at DESC NULLS LAST
  LIMIT v_lim;
END;
$$;

COMMENT ON FUNCTION public.waivers_search_legacy_waivers(uuid, text, integer, boolean) IS
  'Staff search legacy_waivers. Default excludes archived; p_include_archived=true includes 2+ year archived imports.';

GRANT EXECUTE ON FUNCTION public.waivers_search_legacy_waivers(uuid, text, integer, boolean) TO authenticated;
