-- Run in Supabase Dashboard -> SQL Editor (or psql) — NOT via `supabase db query` over the API
-- (HTTP/connection limits will cancel long backfills; here one DB session, statement_timeout off).
-- Before: ensure migration 20260424150000 is applied, and you have a valid pos_loyalty / phone map.
-- Replace the UUID below with your business_id, or the only one with unlinked rows.

SET statement_timeout = 0;
SET lock_timeout = '5min';

DO $body$
DECLARE
  v_bid uuid := 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
  n int;
  total int := 0;
BEGIN
  CREATE TEMP TABLE _pl_pick ON COMMIT DROP AS
  SELECT DISTINCT ON (pl.business_id, public.waiver_otp_phone_digits (pl.customer_phone))
    pl.id,
    pl.business_id,
    public.waiver_otp_phone_digits (pl.customer_phone) AS phone_d
  FROM public.pos_loyalty_accounts pl
  WHERE pl.is_active = true
    AND pl.business_id = v_bid
  ORDER BY
    pl.business_id,
    public.waiver_otp_phone_digits (pl.customer_phone),
    pl.updated_at DESC NULLS LAST,
    pl.created_at DESC NULLS LAST,
    pl.id;
  CREATE INDEX ON _pl_pick (phone_d);

  LOOP
    WITH c AS (
      SELECT
        l2.id,
        p.id AS cust_id
      FROM public.legacy_waivers l2
      INNER JOIN _pl_pick p
        ON p.business_id = v_bid
        AND p.phone_d = public.waiver_otp_phone_digits (l2.phone)
      WHERE l2.deleted_at IS NULL
        AND l2.customer_id IS NULL
        AND l2.business_id = v_bid
        AND length(public.waiver_otp_phone_digits (l2.phone)) >= 10
      ORDER BY l2.id
      LIMIT 2000
    )
    UPDATE public.legacy_waivers l
    SET customer_id = c.cust_id
    FROM c
    WHERE l.id = c.id;

    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
    IF n = 0 THEN
      RAISE NOTICE 'done. total updated: %; remaining with null (any phone) use SELECT count from legacy where customer_id is null', total;
      EXIT;
    END IF;
  END LOOP;
END;
$body$;

DROP TABLE IF EXISTS public._tmp_legacy_pl_pick;
