-- Name of the Day: optional gender hint per minor row (legacy JSON) so girl/boy pools match waiver data, not only SSA name lists + hash.

DROP FUNCTION IF EXISTS public.mail_name_of_day_minor_pool(uuid);

CREATE OR REPLACE FUNCTION public.mail_name_of_day_normalize_gender_hint(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(trim(coalesce(raw, '')))
    WHEN 'f' THEN 'f'
    WHEN 'female' THEN 'f'
    WHEN 'girl' THEN 'f'
    WHEN 'woman' THEN 'f'
    WHEN 'fem' THEN 'f'
    WHEN 'she' THEN 'f'
    WHEN 'm' THEN 'm'
    WHEN 'male' THEN 'm'
    WHEN 'boy' THEN 'm'
    WHEN 'man' THEN 'm'
    WHEN 'mas' THEN 'm'
    WHEN 'he' THEN 'm'
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.mail_name_of_day_normalize_gender_hint(text) IS
  'Maps legacy/minor JSON gender strings to f/m for Name of the Day routing.';

CREATE OR REPLACE FUNCTION public.mail_name_of_day_json_elem_gender_hint(elem jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE jsonb_typeof(elem)
    WHEN 'object' THEN public.mail_name_of_day_normalize_gender_hint(
      coalesce(
        elem->>'gender',
        elem->>'Gender',
        elem->>'sex',
        elem->>'Sex',
        elem->>'g'
      )
    )
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.mail_name_of_day_minor_pool(p_business_id uuid)
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
    AND lower(trim(coalesce(fn.minor_first, ''))) NOT LIKE 'minor %';

$$;

COMMENT ON FUNCTION public.mail_name_of_day_minor_pool(uuid) IS
  'Eligible minors for Name of the Day: modern minors (gender_hint null until captured on participant), legacy arrays include gender_hint from JSON when present.';

GRANT EXECUTE ON FUNCTION public.mail_name_of_day_minor_pool(uuid) TO service_role;
