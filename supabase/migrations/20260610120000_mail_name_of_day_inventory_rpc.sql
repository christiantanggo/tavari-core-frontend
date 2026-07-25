-- Server-side Name-of-Day inventory (one RPC) so the Edge function does not paginate PostgREST 1000-row RPC calls until gateway timeout.

CREATE OR REPLACE FUNCTION public.mail_name_of_day_inventory_snapshot(
  p_business_id uuid,
  p_max_age integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $$
  WITH v_cap AS (
    SELECT LEAST(25, GREATEST(0, COALESCE(NULLIF(p_max_age, 0), 12)))::integer AS cap
  ),
  branch_all AS MATERIALIZED (
    SELECT * FROM public.mail_name_of_day_minor_pool_branch(p_business_id, 'modern')
    UNION ALL
    SELECT * FROM public.mail_name_of_day_minor_pool_branch(p_business_id, 'legacy_minors')
    UNION ALL
    SELECT * FROM public.mail_name_of_day_minor_pool_branch(p_business_id, 'legacy_info')
    UNION ALL
    SELECT * FROM public.mail_name_of_day_minor_pool_branch(p_business_id, 'legacy_notes')
  ),
  dedup AS MATERIALIZED (
    SELECT DISTINCT ON (participant_id, waiver_id, minor_first)
      participant_id,
      waiver_id,
      minor_first,
      minor_dob,
      guardian_email,
      signed_at,
      gender_hint
    FROM branch_all
    ORDER BY participant_id, waiver_id, minor_first, signed_at DESC NULLS LAST
  ),
  aged AS MATERIALIZED (
    SELECT d.*
    FROM dedup d
    CROSS JOIN v_cap c
    WHERE d.minor_dob IS NOT NULL
      AND date_part('year', age (CURRENT_DATE, d.minor_dob::date))::integer >= 0
      AND date_part('year', age (CURRENT_DATE, d.minor_dob::date))::integer <= c.cap
  ),
  mkt AS MATERIALIZED (
    SELECT
      a.participant_id,
      a.waiver_id,
      a.minor_first,
      a.minor_dob,
      a.guardian_email,
      a.signed_at,
      a.gender_hint
    FROM aged a
    INNER JOIN public.mail_contacts mc ON mc.business_id = p_business_id
      AND lower(btrim(mc.email)) = a.guardian_email
    WHERE mc.subscribed IS TRUE
      AND mc.consent_method IS NOT NULL
      AND mc.consent_timestamp IS NOT NULL
  ),
  agg AS (
    SELECT
      lower(btrim(minor_first)) AS normalized_name,
      min(btrim(minor_first)) AS sample_display,
      count(*)::bigint AS eligible_minor_count,
      count(DISTINCT waiver_id)::bigint AS waiver_distinct_count
    FROM mkt
    GROUP BY lower(btrim(minor_first))
  )
  SELECT jsonb_build_object(
    'pool_rows_before_age_filter', (SELECT count(*)::bigint FROM dedup),
    'pool_rows_union_raw', (SELECT count(*)::bigint FROM branch_all),
    'pool_rows_after_age_filter', (SELECT count(*)::bigint FROM aged),
    'pool_rows_after_marketing_filter', (SELECT count(*)::bigint FROM mkt),
    'marketing_eligible_contacts', (
      SELECT count(*)::bigint
      FROM public.mail_contacts mc
      WHERE mc.business_id = p_business_id
        AND mc.subscribed IS TRUE
        AND mc.consent_method IS NOT NULL
        AND mc.consent_timestamp IS NOT NULL
    ),
    'names', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'normalized_name', agg.normalized_name,
            'sample_display', agg.sample_display,
            'eligible_minor_count', agg.eligible_minor_count,
            'waiver_distinct_count', agg.waiver_distinct_count
          )
          ORDER BY agg.eligible_minor_count DESC, agg.normalized_name ASC
        )
        FROM agg
      ),
      '[]'::jsonb
    )
  );
$$;

COMMENT ON FUNCTION public.mail_name_of_day_inventory_snapshot(uuid, integer) IS
  'Aggregated eligible minor first names for Name-of-Day manual inventory (age + marketing filters). Avoids Edge pagination timeouts.';

GRANT EXECUTE ON FUNCTION public.mail_name_of_day_inventory_snapshot(uuid, integer) TO service_role;


CREATE OR REPLACE FUNCTION public.mail_name_of_day_inventory_recipients_for_name(
  p_business_id uuid,
  p_max_age integer,
  p_normalized_name text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $$
DECLARE
  v_cap integer := LEAST(25, GREATEST(0, COALESCE(NULLIF(p_max_age, 0), 12)));
  v_norm text := lower(btrim(p_normalized_name));
  v_out jsonb;
BEGIN
  IF length(v_norm) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH branch_all AS MATERIALIZED (
    SELECT * FROM public.mail_name_of_day_minor_pool_branch(p_business_id, 'modern')
    UNION ALL
    SELECT * FROM public.mail_name_of_day_minor_pool_branch(p_business_id, 'legacy_minors')
    UNION ALL
    SELECT * FROM public.mail_name_of_day_minor_pool_branch(p_business_id, 'legacy_info')
    UNION ALL
    SELECT * FROM public.mail_name_of_day_minor_pool_branch(p_business_id, 'legacy_notes')
  ),
  dedup AS MATERIALIZED (
    SELECT DISTINCT ON (participant_id, waiver_id, minor_first)
      participant_id,
      waiver_id,
      minor_first,
      minor_dob,
      guardian_email,
      signed_at,
      gender_hint
    FROM branch_all
    ORDER BY participant_id, waiver_id, minor_first, signed_at DESC NULLS LAST
  ),
  aged AS MATERIALIZED (
    SELECT *
    FROM dedup
    WHERE minor_dob IS NOT NULL
      AND date_part('year', age (CURRENT_DATE, minor_dob::date))::integer >= 0
      AND date_part('year', age (CURRENT_DATE, minor_dob::date))::integer <= v_cap
  ),
  mkt AS MATERIALIZED (
    SELECT
      a.participant_id,
      a.waiver_id,
      a.minor_first,
      a.guardian_email
    FROM aged a
    INNER JOIN public.mail_contacts mc ON mc.business_id = p_business_id
      AND lower(btrim(mc.email)) = a.guardian_email
    WHERE mc.subscribed IS TRUE
      AND mc.consent_method IS NOT NULL
      AND mc.consent_timestamp IS NOT NULL
      AND lower(btrim(a.minor_first)) = v_norm
  ),
  by_email AS (
    SELECT
      m.guardian_email AS email,
      max(mc.first_name) AS contact_first_name,
      max(mc.last_name) AS contact_last_name,
      jsonb_agg(
        jsonb_build_object(
          'participant_id', m.participant_id,
          'minor_first', btrim(m.minor_first)
        )
        ORDER BY m.participant_id
      ) AS minors
    FROM mkt m
    INNER JOIN public.mail_contacts mc ON mc.business_id = p_business_id
      AND lower(btrim(mc.email)) = m.guardian_email
    GROUP BY m.guardian_email
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'email', by_email.email,
        'contact_first_name', by_email.contact_first_name,
        'contact_last_name', by_email.contact_last_name,
        'minors', by_email.minors
      )
      ORDER BY by_email.email
    ),
    '[]'::jsonb
  )
  INTO v_out
  FROM by_email;

  RETURN coalesce(v_out, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.mail_name_of_day_inventory_recipients_for_name(uuid, integer, text) IS
  'Guardians (marketing-eligible) who would receive Name-of-Day email for one normalized first name.';

GRANT EXECUTE ON FUNCTION public.mail_name_of_day_inventory_recipients_for_name(uuid, integer, text) TO service_role;
