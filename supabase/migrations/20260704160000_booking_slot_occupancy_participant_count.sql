-- Count day camp / drop-in capacity by participants (campers), not booking rows.

CREATE OR REPLACE FUNCTION public.booking_activity_counts_participants(p_activity_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(bt.type_key, '') IN ('day_camp', 'drop_in_play')
  FROM public.booking_activities ba
  LEFT JOIN public.booking_types bt ON bt.id = ba.type_id
  WHERE ba.id = p_activity_id;
$$;

CREATE OR REPLACE FUNCTION public.booking_occupancy_units_for_booking(
  p_activity_id UUID,
  p_booking_id UUID
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.booking_activity_counts_participants(p_activity_id) THEN
      GREATEST(
        1,
        COALESCE((
          SELECT COUNT(*)::INTEGER
          FROM public.booking_participants bp
          WHERE bp.booking_id = p_booking_id
        ), 0)
      )
    ELSE 1
  END;
$$;

CREATE OR REPLACE FUNCTION public.booking_count_slot_occupied_units(
  p_business_id UUID,
  p_activity_id UUID,
  p_booking_date DATE,
  p_booking_time TIME,
  p_exclude_booking_id UUID DEFAULT NULL
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
  IF public.booking_activity_counts_participants(p_activity_id) THEN
    SELECT COALESCE(SUM(public.booking_occupancy_units_for_booking(p_activity_id, b.id)), 0)::INTEGER
    INTO v_count
    FROM public.bookings b
    WHERE b.business_id = p_business_id
      AND b.activity_id = p_activity_id
      AND b.booking_date = p_booking_date
      AND b.booking_time::time = p_booking_time::time
      AND b.status IN ('pending', 'confirmed', 'checked_in')
      AND (p_exclude_booking_id IS NULL OR b.id <> p_exclude_booking_id);
  ELSE
    SELECT COUNT(*)::INTEGER
    INTO v_count
    FROM public.bookings b
    WHERE b.business_id = p_business_id
      AND b.activity_id = p_activity_id
      AND b.booking_date = p_booking_date
      AND b.booking_time::time = p_booking_time::time
      AND b.status IN ('pending', 'confirmed', 'checked_in')
      AND (p_exclude_booking_id IS NULL OR b.id <> p_exclude_booking_id);
  END IF;

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
  v_count_participants BOOLEAN;
BEGIN
  v_count_participants := public.booking_activity_counts_participants(p_activity_id);

  IF v_count_participants THEN
    FOR v_row IN
      SELECT
        to_char(b.booking_time::time, 'HH24:MI') AS time_key,
        SUM(public.booking_occupancy_units_for_booking(p_activity_id, b.id))::INTEGER AS cnt
      FROM public.bookings b
      WHERE b.business_id = p_business_id
        AND b.activity_id = p_activity_id
        AND b.booking_date = p_booking_date
        AND b.status IN ('pending', 'confirmed', 'checked_in')
      GROUP BY 1
    LOOP
      v_result := v_result || jsonb_build_object(v_row.time_key, v_row.cnt);
    END LOOP;
  ELSE
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
  END IF;

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

CREATE OR REPLACE FUNCTION public.booking_acquire_slot_hold(
  p_business_id UUID,
  p_activity_id UUID,
  p_booking_date DATE,
  p_booking_time TIME,
  p_hold_token TEXT,
  p_customer_id UUID DEFAULT NULL,
  p_spaces_requested INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_spaces INTEGER;
  v_occupied INTEGER;
  v_holds INTEGER;
  v_expires_at TIMESTAMPTZ;
  v_requested INTEGER;
BEGIN
  IF p_business_id IS NULL OR p_activity_id IS NULL OR p_booking_date IS NULL
     OR p_booking_time IS NULL OR COALESCE(trim(p_hold_token), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Missing hold parameters.');
  END IF;

  PERFORM public.booking_release_stale_slot_holds();

  UPDATE public.booking_slot_holds
  SET released_at = now()
  WHERE hold_token = p_hold_token
    AND released_at IS NULL;

  v_spaces := public.booking_resolve_schedule_spaces(
    p_business_id, p_activity_id, p_booking_date, p_booking_time
  );

  v_occupied := public.booking_count_slot_occupied_units(
    p_business_id, p_activity_id, p_booking_date, p_booking_time, NULL
  );

  v_holds := public.booking_count_active_slot_holds(
    p_business_id, p_activity_id, p_booking_date, p_booking_time, p_hold_token
  );

  v_requested := GREATEST(1, COALESCE(p_spaces_requested, 1));

  IF (COALESCE(v_occupied, 0) + COALESCE(v_holds, 0) + v_requested) > v_spaces THEN
    RETURN jsonb_build_object(
      'ok', false,
      'message', 'This time slot was just taken. Please choose another time.'
    );
  END IF;

  v_expires_at := now() + interval '10 minutes';

  INSERT INTO public.booking_slot_holds (
    business_id,
    activity_id,
    booking_date,
    booking_time,
    hold_token,
    customer_id,
    expires_at,
    last_activity_at
  ) VALUES (
    p_business_id,
    p_activity_id,
    p_booking_date,
    p_booking_time,
    p_hold_token,
    p_customer_id,
    v_expires_at,
    now()
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expires_at', v_expires_at,
    'seconds_remaining', 600,
    'idle_seconds', 120
  );
END;
$$;

COMMENT ON FUNCTION public.booking_activity_counts_participants(UUID) IS
  'True when slot capacity should count campers/participants (day camp, drop-in), not booking rows.';

COMMENT ON FUNCTION public.booking_count_slot_occupied_units(UUID, UUID, DATE, TIME, UUID) IS
  'Occupied units for one schedule slot: participants for day camp/drop-in, else booking count.';

GRANT EXECUTE ON FUNCTION public.booking_activity_counts_participants(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_occupancy_units_for_booking(UUID, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_count_slot_occupied_units(UUID, UUID, DATE, TIME, UUID) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.booking_acquire_slot_hold(UUID, UUID, DATE, TIME, TEXT, UUID, INTEGER) TO anon, authenticated, service_role;
