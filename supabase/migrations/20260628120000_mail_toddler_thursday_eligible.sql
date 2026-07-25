-- Toddler Thursday: eligible guardians with ≥1 toddler (ages 1–3) on any waiver (including expired).

CREATE OR REPLACE FUNCTION public.mail_toddler_thursday_eligible_guardians(
  p_business_id uuid,
  p_min_age_years integer DEFAULT 1,
  p_max_age_years integer DEFAULT 3
)
RETURNS TABLE (
  contact_id uuid,
  email text,
  first_name text,
  last_name text,
  toddler_count integer,
  toddler_first_names text[],
  has_expired_waiver boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $$
  WITH bounds AS (
    SELECT
      GREATEST(0, COALESCE(p_min_age_years, 1))::integer AS min_age,
      GREATEST(COALESCE(p_min_age_years, 1), COALESCE(p_max_age_years, 3))::integer AS max_age
  ),
  modern_minors AS (
    SELECT
      lower(btrim(coalesce(ws.email, ''))) AS guardian_email,
      btrim(wp.first_name) AS minor_first,
      wp.date_of_birth::date AS minor_dob,
      ws.id AS waiver_id,
      (
        ws.expires_at IS NOT NULL AND ws.expires_at <= timezone('utc'::text, now())
      ) OR ws.archived_at IS NOT NULL AS waiver_expired
    FROM public.waiver_participants wp
    INNER JOIN public.waiver_signatures ws ON ws.id = wp.waiver_id
    CROSS JOIN bounds b
    WHERE ws.business_id = p_business_id
      AND length(btrim(wp.first_name)) > 0
      AND wp.date_of_birth IS NOT NULL
      AND lower(btrim(coalesce(wp.participant_type, ''))) = 'minor'
      AND date_part('year', age(CURRENT_DATE, wp.date_of_birth::date))::integer >= b.min_age
      AND date_part('year', age(CURRENT_DATE, wp.date_of_birth::date))::integer <= b.max_age
  ),
  legacy_minors AS (
    SELECT
      lower(btrim(coalesce(lw.email, ''))) AS guardian_email,
      btrim(coalesce(elem->>'first_name', elem->>'firstName', '')) AS minor_first,
      coalesce(
        nullif(trim(elem->>'date_of_birth'), '')::date,
        nullif(trim(elem->>'dob'), '')::date,
        nullif(trim(elem->>'dateOfBirth'), '')::date
      ) AS minor_dob,
      lw.id AS waiver_id,
      lw.archived_at IS NOT NULL
        OR coalesce(lw.signed_at, lw.created_at, lw.imported_at)
          < timezone('utc'::text, now()) - interval '365 days' AS waiver_expired
    FROM public.legacy_waivers lw
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(lw.legacy_minors) = 'array' AND jsonb_array_length(lw.legacy_minors) > 0
        THEN lw.legacy_minors
        ELSE '[]'::jsonb
      END
    ) AS elem
    CROSS JOIN bounds b
    WHERE lw.business_id = p_business_id
      AND lw.deleted_at IS NULL
      AND length(btrim(coalesce(elem->>'first_name', elem->>'firstName', ''))) > 0
      AND coalesce(
        nullif(trim(elem->>'date_of_birth'), '')::date,
        nullif(trim(elem->>'dob'), '')::date,
        nullif(trim(elem->>'dateOfBirth'), '')::date
      ) IS NOT NULL
      AND date_part(
        'year',
        age(
          CURRENT_DATE,
          coalesce(
            nullif(trim(elem->>'date_of_birth'), '')::date,
            nullif(trim(elem->>'dob'), '')::date,
            nullif(trim(elem->>'dateOfBirth'), '')::date
          )
        )
      )::integer >= b.min_age
      AND date_part(
        'year',
        age(
          CURRENT_DATE,
          coalesce(
            nullif(trim(elem->>'date_of_birth'), '')::date,
            nullif(trim(elem->>'dob'), '')::date,
            nullif(trim(elem->>'dateOfBirth'), '')::date
          )
        )
      )::integer <= b.max_age
  ),
  legacy_info_minors AS (
    SELECT
      lower(btrim(coalesce(lw.email, ''))) AS guardian_email,
      fn.minor_first,
      fn.minor_dob,
      lw.id AS waiver_id,
      lw.archived_at IS NOT NULL
        OR coalesce(lw.signed_at, lw.created_at, lw.imported_at)
          < timezone('utc'::text, now()) - interval '365 days' AS waiver_expired
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
        btrim(coalesce(elem->>'first_name', elem->>'firstName', elem->>'name', '')) AS minor_first,
        coalesce(
          nullif(trim(elem->>'date_of_birth'), '')::date,
          nullif(trim(elem->>'dob'), '')::date,
          nullif(trim(elem->>'dateOfBirth'), '')::date
        ) AS minor_dob
    ) AS fn
    CROSS JOIN bounds b
    WHERE lw.business_id = p_business_id
      AND lw.deleted_at IS NULL
      AND length(fn.minor_first) > 0
      AND fn.minor_dob IS NOT NULL
      AND date_part('year', age(CURRENT_DATE, fn.minor_dob))::integer >= b.min_age
      AND date_part('year', age(CURRENT_DATE, fn.minor_dob))::integer <= b.max_age
  ),
  all_minors AS (
    SELECT * FROM modern_minors
    UNION ALL
    SELECT * FROM legacy_minors
    UNION ALL
    SELECT * FROM legacy_info_minors
  ),
  filtered AS (
    SELECT *
    FROM all_minors
    WHERE guardian_email ~ '^[^@]+@[^@]+\.[^@]+$'
  ),
  by_email AS (
    SELECT
      f.guardian_email,
      count(*)::integer AS toddler_count,
      array_agg(DISTINCT f.minor_first ORDER BY f.minor_first) AS toddler_first_names,
      bool_or(f.waiver_expired) AS has_expired_waiver
    FROM filtered f
    GROUP BY f.guardian_email
  )
  SELECT
    mc.id AS contact_id,
    mc.email,
    mc.first_name,
    mc.last_name,
    be.toddler_count,
    be.toddler_first_names,
    be.has_expired_waiver
  FROM by_email be
  INNER JOIN public.mail_contacts mc
    ON mc.business_id = p_business_id
    AND lower(btrim(mc.email)) = be.guardian_email
  WHERE mc.subscribed IS TRUE
    AND mc.consent_method IS NOT NULL
    AND mc.consent_timestamp IS NOT NULL;
$$;

COMMENT ON FUNCTION public.mail_toddler_thursday_eligible_guardians(uuid, integer, integer) IS
  'Marketing-eligible guardians with at least one toddler (default ages 1–3) on any waiver, including expired.';

GRANT EXECUTE ON FUNCTION public.mail_toddler_thursday_eligible_guardians(uuid, integer, integer) TO service_role;
