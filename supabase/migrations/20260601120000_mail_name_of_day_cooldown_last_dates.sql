-- Batched “last pick before date” for Name-of-Day scoring cooldowns.
-- The edge function used to run 2 DB round-trips per distinct name (O(n) HTTP),
-- which exceeded Supabase worker CPU limits (HTTP 546) for large minor pools.

CREATE OR REPLACE FUNCTION public.mail_name_of_day_cooldown_last_dates(
  p_business_id uuid,
  p_normalized text[],
  p_before date
)
RETURNS TABLE(normalized text, last_local_date date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH norms AS (
    SELECT DISTINCT unnest(p_normalized) AS norm
  ),
  girl AS (
    SELECT p.girl_normalized AS norm, MAX(p.local_date)::date AS d
    FROM public.mail_name_of_day_picks p
    WHERE p.business_id = p_business_id
      AND p.local_date < p_before
      AND p.girl_normalized = ANY(p_normalized)
    GROUP BY p.girl_normalized
  ),
  boy AS (
    SELECT p.boy_normalized AS norm, MAX(p.local_date)::date AS d
    FROM public.mail_name_of_day_picks p
    WHERE p.business_id = p_business_id
      AND p.local_date < p_before
      AND p.boy_normalized = ANY(p_normalized)
    GROUP BY p.boy_normalized
  ),
  merged AS (
    SELECT u.norm, MAX(u.d) AS last_local_date
    FROM (
      SELECT norm, d FROM girl
      UNION ALL
      SELECT norm, d FROM boy
    ) u
    GROUP BY u.norm
  )
  SELECT n.norm::text,
         m.last_local_date
  FROM norms n
  LEFT JOIN merged m ON m.norm = n.norm;
$$;

COMMENT ON FUNCTION public.mail_name_of_day_cooldown_last_dates(uuid, text[], date) IS
  'Returns each normalized name''s latest prior pick date (girl or boy column) before p_before; used for batched cooldown scoring.';

GRANT EXECUTE ON FUNCTION public.mail_name_of_day_cooldown_last_dates(uuid, text[], date) TO service_role;
