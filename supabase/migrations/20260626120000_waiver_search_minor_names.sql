-- Improve waiver dashboard search so minor names match (legacy JSON + modern participants).

CREATE OR REPLACE FUNCTION public.waivers_legacy_minors_contains_all_tokens(p_minors jsonb, p_raw text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(
    (
      SELECT bool_and(
        coalesce(p_minors::text, '') ILIKE '%' || public.waivers_escape_ilike_pattern(trim(token)) || '%' ESCAPE '\'
      )
      FROM regexp_split_to_table(trim(coalesce(p_raw, '')), '\s+') AS token
      WHERE length(trim(token)) > 0
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.waivers_legacy_minors_name_pair_match(p_minors jsonb, p_a text, p_b text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(coalesce(p_minors, '[]'::jsonb)) AS elem
    WHERE (
      coalesce(elem->>'first_name', '') ILIKE '%' || public.waivers_escape_ilike_pattern(p_a) || '%' ESCAPE '\'
      AND coalesce(elem->>'last_name', '') ILIKE '%' || public.waivers_escape_ilike_pattern(p_b) || '%' ESCAPE '\'
    )
    OR (
      coalesce(elem->>'first_name', '') ILIKE '%' || public.waivers_escape_ilike_pattern(p_b) || '%' ESCAPE '\'
      AND coalesce(elem->>'last_name', '') ILIKE '%' || public.waivers_escape_ilike_pattern(p_a) || '%' ESCAPE '\'
    )
  );
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
  v_word_a text;
  v_word_b text;
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
    v_word_a := trim(split_part(v_raw, ' ', 1));
    v_word_b := trim(split_part(v_raw, ' ', 2));
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
      OR public.waivers_legacy_minors_contains_all_tokens(lw.legacy_minors, v_raw)
      OR (
        length(coalesce(v_word_a, '')) > 0
        AND length(coalesce(v_word_b, '')) > 1
        AND public.waivers_legacy_minors_name_pair_match(lw.legacy_minors, v_word_a, v_word_b)
      )
      OR (
        length(coalesce(v_last, '')) > 0
        AND length(coalesce(v_first_initial, '')) = 1
        AND lw.last_name ILIKE '%' || v_last || '%' ESCAPE '\'
        AND lw.first_name ILIKE v_first_initial || '%' ESCAPE '\'
      )
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

CREATE OR REPLACE FUNCTION public.waivers_search_participant_waiver_ids(
  p_business_id uuid,
  p_search text,
  p_limit integer DEFAULT 500
)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw text := trim(coalesce(p_search, ''));
  v_pat text;
  v_lim integer := LEAST(GREATEST(coalesce(p_limit, 500), 1), 500);
  v_last text;
  v_first_initial text;
  v_word_a text;
  v_word_b text;
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
  IF position(' ' in v_raw) > 0 THEN
    v_last := public.waivers_escape_ilike_pattern(split_part(v_raw, ' ', 1));
    v_first_initial := public.waivers_escape_ilike_pattern(split_part(v_raw, ' ', 2));
    v_word_a := trim(split_part(v_raw, ' ', 1));
    v_word_b := trim(split_part(v_raw, ' ', 2));
  END IF;

  RETURN QUERY
  SELECT DISTINCT wp.waiver_id
  FROM public.waiver_participants wp
  INNER JOIN public.waiver_signatures ws ON ws.id = wp.waiver_id
  WHERE ws.business_id = p_business_id
    AND wp.waiver_id IS NOT NULL
    AND (
      coalesce(wp.first_name, '') ILIKE '%' || v_pat || '%' ESCAPE '\'
      OR coalesce(wp.last_name, '') ILIKE '%' || v_pat || '%' ESCAPE '\'
      OR coalesce(wp.email, '') ILIKE '%' || v_pat || '%' ESCAPE '\'
      OR coalesce(wp.phone_number, '') ILIKE '%' || v_pat || '%' ESCAPE '\'
      OR (coalesce(wp.first_name, '') || ' ' || coalesce(wp.last_name, '')) ILIKE '%' || v_pat || '%' ESCAPE '\'
      OR (coalesce(wp.last_name, '') || ' ' || coalesce(wp.first_name, '')) ILIKE '%' || v_pat || '%' ESCAPE '\'
      OR (
        length(coalesce(v_word_a, '')) > 0
        AND length(coalesce(v_word_b, '')) > 1
        AND (
          (
            coalesce(wp.first_name, '') ILIKE '%' || public.waivers_escape_ilike_pattern(v_word_a) || '%' ESCAPE '\'
            AND coalesce(wp.last_name, '') ILIKE '%' || public.waivers_escape_ilike_pattern(v_word_b) || '%' ESCAPE '\'
          )
          OR (
            coalesce(wp.first_name, '') ILIKE '%' || public.waivers_escape_ilike_pattern(v_word_b) || '%' ESCAPE '\'
            AND coalesce(wp.last_name, '') ILIKE '%' || public.waivers_escape_ilike_pattern(v_word_a) || '%' ESCAPE '\'
          )
        )
      )
      OR (
        length(coalesce(v_last, '')) > 0
        AND length(coalesce(v_first_initial, '')) = 1
        AND coalesce(wp.last_name, '') ILIKE '%' || v_last || '%' ESCAPE '\'
        AND coalesce(wp.first_name, '') ILIKE v_first_initial || '%' ESCAPE '\'
      )
    )
  LIMIT v_lim;
END;
$$;

COMMENT ON FUNCTION public.waivers_search_legacy_waivers(uuid, text, integer, boolean) IS
  'Staff search legacy_waivers including minor names in legacy_minors JSON.';

COMMENT ON FUNCTION public.waivers_search_participant_waiver_ids(uuid, text, integer) IS
  'Return waiver_signatures ids whose participants match the search text (minors/additional adults).';

GRANT EXECUTE ON FUNCTION public.waivers_search_legacy_waivers(uuid, text, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.waivers_search_participant_waiver_ids(uuid, text, integer) TO authenticated;
