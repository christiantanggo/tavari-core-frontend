-- Fix portal slot occupancy RPCs: STABLE + UPDATE caused "read-only transaction" errors on Supabase.

CREATE OR REPLACE FUNCTION public.booking_count_active_slot_holds(
  p_business_id UUID,
  p_activity_id UUID,
  p_booking_date DATE,
  p_booking_time TIME,
  p_exclude_hold_token TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER
  INTO v_count
  FROM public.booking_slot_holds h
  WHERE h.business_id = p_business_id
    AND h.activity_id = p_activity_id
    AND h.booking_date = p_booking_date
    AND h.booking_time::time = p_booking_time::time
    AND h.released_at IS NULL
    AND h.expires_at > now()
    AND h.last_activity_at > now() - interval '2 minutes'
    AND (p_exclude_hold_token IS NULL OR h.hold_token <> p_exclude_hold_token);

  RETURN COALESCE(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.booking_get_portal_slot_occupancy(
  p_business_id UUID,
  p_activity_id UUID,
  p_booking_date DATE,
  p_exclude_hold_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB := '{}'::JSONB;
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT
      to_char(b.booking_time::time, 'HH24:MI') AS time_key,
      COUNT(*)::INTEGER AS cnt
    FROM public.bookings b
    WHERE b.business_id = p_business_id
      AND b.activity_id = p_activity_id
      AND b.booking_date = p_booking_date
      AND b.status IN ('pending', 'confirmed', 'checked_in')
    GROUP BY 1
  LOOP
    v_result := v_result || jsonb_build_object(v_row.time_key, v_row.cnt);
  END LOOP;

  FOR v_row IN
    SELECT
      to_char(h.booking_time::time, 'HH24:MI') AS time_key,
      COUNT(*)::INTEGER AS cnt
    FROM public.booking_slot_holds h
    WHERE h.business_id = p_business_id
      AND h.activity_id = p_activity_id
      AND h.booking_date = p_booking_date
      AND h.released_at IS NULL
      AND h.expires_at > now()
      AND h.last_activity_at > now() - interval '2 minutes'
      AND (p_exclude_hold_token IS NULL OR h.hold_token <> p_exclude_hold_token)
    GROUP BY 1
  LOOP
    v_result := v_result || jsonb_build_object(
      v_row.time_key,
      COALESCE((v_result ->> v_row.time_key)::INTEGER, 0) + v_row.cnt
    );
  END LOOP;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.booking_get_portal_slot_occupancy(UUID, UUID, DATE, TEXT) IS
  'Read-only portal occupancy map. Stale holds are excluded by query filters; cleanup runs on write RPCs only.';
