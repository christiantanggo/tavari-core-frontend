-- Name of the Day: include imported legacy minors (legacy_waivers.legacy_minors) alongside modern waiver_participants.

CREATE OR REPLACE FUNCTION public.mail_name_of_day_minor_pool(p_business_id uuid)
RETURNS TABLE (
  participant_id uuid,
  waiver_id uuid,
  minor_first text,
  minor_dob date,
  guardian_email text,
  signed_at timestamptz
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
    ws.signed_at
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
    coalesce(lw.signed_at, lw.created_at, lw.imported_at)
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
    AND lower(btrim(coalesce(elem->>'first_name', elem->>'firstName', ''))) NOT LIKE 'minor %';

$$;

COMMENT ON FUNCTION public.mail_name_of_day_minor_pool(uuid) IS
  'Eligible minors for Name of the Day: modern waiver_participants (participant_type=minor) plus legacy_waivers.legacy_minors JSON array.';
