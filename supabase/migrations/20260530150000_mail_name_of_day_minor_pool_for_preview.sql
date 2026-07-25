-- Fast path for mail-automation-preview: only minors whose first name matches the day’s girl/boy
-- normalized names (avoids full-pool scan + PostgREST pagination → statement timeout).
-- Per-branch name filter is applied so the planner can skip rows before emitting unnested JSON where possible.

DROP FUNCTION IF EXISTS public.mail_name_of_day_minor_pool_for_preview(uuid, text, text);

CREATE OR REPLACE FUNCTION public.mail_name_of_day_minor_pool_for_preview(
  p_business_id uuid,
  p_girl_norm text,
  p_boy_norm text
)
RETURNS TABLE (
  participant_id uuid,
  waiver_id uuid,
  minor_first text,
  minor_dob date,
  guardian_email text,
  signed_at timestamptz,
  gender_hint text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  SELECT
    wp.id,
    wp.waiver_id,
    btrim(wp.first_name),
    wp.date_of_birth::date,
    lower(btrim(coalesce(ws.email, ''))),
    ws.signed_at,
    NULL::text
  FROM public.waiver_participants wp
  INNER JOIN public.waiver_signatures ws ON ws.id = wp.waiver_id
  WHERE ws.business_id = p_business_id
    AND length(btrim(wp.first_name)) > 0
    AND lower(btrim(coalesce(wp.participant_type, ''))) = 'minor'
    AND (
      (length(nullif(lower(trim(p_girl_norm)), '')) > 0 AND lower(btrim(wp.first_name)) = lower(trim(p_girl_norm)))
      OR
      (length(nullif(lower(trim(p_boy_norm)), '')) > 0 AND lower(btrim(wp.first_name)) = lower(trim(p_boy_norm)))
    )

  UNION ALL

  SELECT
    (
      substring(x.h FROM 1 FOR 8) || '-' ||
      substring(x.h FROM 9 FOR 4) || '-5' ||
      substring(x.h FROM 13 FOR 3) || '-' ||
      '8' || substring(x.h FROM 16 FOR 3) || '-' ||
      substring(x.h FROM 19 FOR 12)
    )::uuid,
    lw.id,
    btrim(coalesce(elem->>'first_name', elem->>'firstName', '')),
    coalesce(
      nullif(trim(elem->>'date_of_birth'), '')::date,
      nullif(trim(elem->>'dob'), '')::date,
      nullif(trim(elem->>'dateOfBirth'), '')::date
    ),
    lower(btrim(coalesce(lw.email, ''))),
    coalesce(lw.signed_at, lw.created_at, lw.imported_at),
    public.mail_name_of_day_json_elem_gender_hint(elem)
  FROM public.legacy_waivers lw
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(lw.legacy_minors) = 'array' AND jsonb_array_length(lw.legacy_minors) > 0
      THEN lw.legacy_minors
      ELSE '[]'::jsonb
    END
  ) AS elem
  CROSS JOIN LATERAL (
    SELECT md5(
      concat_ws(
        '|',
        p_business_id::text,
        lw.id::text,
        'legacy_minors',
        lower(trim(coalesce(elem->>'first_name', elem->>'firstName', ''))),
        coalesce(
          nullif(trim(elem->>'date_of_birth'), ''),
          nullif(trim(elem->>'dob'), ''),
          nullif(trim(elem->>'dateOfBirth'), ''),
          ''
        )
      )
    ) AS h
  ) AS x
  WHERE lw.business_id = p_business_id
    AND lw.deleted_at IS NULL
    AND length(btrim(coalesce(elem->>'first_name', elem->>'firstName', ''))) > 0
    AND lower(btrim(coalesce(elem->>'first_name', elem->>'firstName', ''))) NOT LIKE 'minor %'
    AND (
      (length(nullif(lower(trim(p_girl_norm)), '')) > 0
        AND lower(btrim(coalesce(elem->>'first_name', elem->>'firstName', ''))) = lower(trim(p_girl_norm)))
      OR
      (length(nullif(lower(trim(p_boy_norm)), '')) > 0
        AND lower(btrim(coalesce(elem->>'first_name', elem->>'firstName', ''))) = lower(trim(p_boy_norm)))
    )

  UNION ALL

  SELECT
    (
      substring(x.h FROM 1 FOR 8) || '-' ||
      substring(x.h FROM 9 FOR 4) || '-5' ||
      substring(x.h FROM 13 FOR 3) || '-' ||
      '8' || substring(x.h FROM 16 FOR 3) || '-' ||
      substring(x.h FROM 19 FOR 12)
    )::uuid,
    lw.id,
    fn.minor_first,
    fn.minor_dob,
    lower(btrim(coalesce(lw.email, ''))),
    coalesce(lw.signed_at, lw.created_at, lw.imported_at),
    public.mail_name_of_day_json_elem_gender_hint(elem)
  FROM public.legacy_waivers lw
  CROSS JOIN LATERAL (SELECT public.safe_jsonb_from_text(lw.info) AS j) AS inf
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(inf.j -> 'minors') = 'array' THEN inf.j -> 'minors'
      WHEN jsonb_typeof(inf.j -> 'children') = 'array' THEN inf.j -> 'children'
      WHEN jsonb_typeof(inf.j -> 'child_participants') = 'array' THEN inf.j -> 'child_participants'
      ELSE '[]'::jsonb
    END
  ) AS elem
  CROSS JOIN LATERAL (
    SELECT
      CASE jsonb_typeof(elem)
        WHEN 'string' THEN nullif(split_part(btrim(elem #>> '{}'), ' ', 1), '')
        ELSE nullif(
          btrim(coalesce(elem->>'first_name', elem->>'firstName', elem->>'name', elem->>'given')),
          ''
        )
      END AS minor_first,
      CASE jsonb_typeof(elem)
        WHEN 'object' THEN coalesce(
          nullif(trim(elem->>'date_of_birth'), '')::date,
          nullif(trim(elem->>'dob'), '')::date,
          nullif(trim(elem->>'dateOfBirth'), '')::date
        )
        ELSE NULL::date
      END AS minor_dob
  ) AS fn
  CROSS JOIN LATERAL (
    SELECT md5(
      concat_ws(
        '|',
        p_business_id::text,
        lw.id::text,
        'info_json',
        lower(trim(coalesce(fn.minor_first, ''))),
        coalesce(fn.minor_dob::text, '')
      )
    ) AS h
  ) AS x
  WHERE lw.business_id = p_business_id
    AND lw.deleted_at IS NULL
    AND inf.j IS NOT NULL
    AND length(trim(coalesce(fn.minor_first, ''))) > 0
    AND lower(trim(coalesce(fn.minor_first, ''))) NOT LIKE 'minor %'
    AND (
      (length(nullif(lower(trim(p_girl_norm)), '')) > 0 AND lower(btrim(coalesce(fn.minor_first, ''))) = lower(trim(p_girl_norm)))
      OR
      (length(nullif(lower(trim(p_boy_norm)), '')) > 0 AND lower(btrim(coalesce(fn.minor_first, ''))) = lower(trim(p_boy_norm)))
    )

  UNION ALL

  SELECT
    (
      substring(x.h FROM 1 FOR 8) || '-' ||
      substring(x.h FROM 9 FOR 4) || '-5' ||
      substring(x.h FROM 13 FOR 3) || '-' ||
      '8' || substring(x.h FROM 16 FOR 3) || '-' ||
      substring(x.h FROM 19 FOR 12)
    )::uuid,
    lw.id,
    fn.minor_first,
    fn.minor_dob,
    lower(btrim(coalesce(lw.email, ''))),
    coalesce(lw.signed_at, lw.created_at, lw.imported_at),
    public.mail_name_of_day_json_elem_gender_hint(elem)
  FROM public.legacy_waivers lw
  CROSS JOIN LATERAL (SELECT public.safe_jsonb_from_text(lw.notes) AS j) AS nts
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(nts.j -> 'minors') = 'array' THEN nts.j -> 'minors'
      WHEN jsonb_typeof(nts.j -> 'children') = 'array' THEN nts.j -> 'children'
      WHEN jsonb_typeof(nts.j -> 'child_participants') = 'array' THEN nts.j -> 'child_participants'
      ELSE '[]'::jsonb
    END
  ) AS elem
  CROSS JOIN LATERAL (
    SELECT
      CASE jsonb_typeof(elem)
        WHEN 'string' THEN nullif(split_part(btrim(elem #>> '{}'), ' ', 1), '')
        ELSE nullif(
          btrim(coalesce(elem->>'first_name', elem->>'firstName', elem->>'name', elem->>'given')),
          ''
        )
      END AS minor_first,
      CASE jsonb_typeof(elem)
        WHEN 'object' THEN coalesce(
          nullif(trim(elem->>'date_of_birth'), '')::date,
          nullif(trim(elem->>'dob'), '')::date,
          nullif(trim(elem->>'dateOfBirth'), '')::date
        )
        ELSE NULL::date
      END AS minor_dob
  ) AS fn
  CROSS JOIN LATERAL (
    SELECT md5(
      concat_ws(
        '|',
        p_business_id::text,
        lw.id::text,
        'notes_json',
        lower(trim(coalesce(fn.minor_first, ''))),
        coalesce(fn.minor_dob::text, '')
      )
    ) AS h
  ) AS x
  WHERE lw.business_id = p_business_id
    AND lw.deleted_at IS NULL
    AND nts.j IS NOT NULL
    AND length(trim(coalesce(fn.minor_first, ''))) > 0
    AND lower(trim(coalesce(fn.minor_first, ''))) NOT LIKE 'minor %'
    AND (
      (length(nullif(lower(trim(p_girl_norm)), '')) > 0 AND lower(btrim(coalesce(fn.minor_first, ''))) = lower(trim(p_girl_norm)))
      OR
      (length(nullif(lower(trim(p_boy_norm)), '')) > 0 AND lower(btrim(coalesce(fn.minor_first, ''))) = lower(trim(p_boy_norm)))
    );
$$;

COMMENT ON FUNCTION public.mail_name_of_day_minor_pool_for_preview(uuid, text, text) IS
  'Name-of-Day automation preview: minors matching only the chosen girl/boy normalized names (fast).';

GRANT EXECUTE ON FUNCTION public.mail_name_of_day_minor_pool_for_preview(uuid, text, text) TO service_role;
