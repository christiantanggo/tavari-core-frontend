-- Drop-in play: every attendee (adult + child) consumes one schedule seat.
-- Day camp: campers/children only (unchanged).
-- Parties and other types: one booking = one slot (unchanged).

CREATE OR REPLACE FUNCTION public.booking_activity_counts_all_participants(p_activity_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(bt.type_key, '') = 'drop_in_play'
  FROM public.booking_activities ba
  LEFT JOIN public.booking_types bt ON bt.id = ba.type_id
  WHERE ba.id = p_activity_id;
$$;

CREATE OR REPLACE FUNCTION public.booking_activity_counts_participants(p_activity_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(bt.type_key, '') = 'day_camp'
  FROM public.booking_activities ba
  LEFT JOIN public.booking_types bt ON bt.id = ba.type_id
  WHERE ba.id = p_activity_id;
$$;

CREATE OR REPLACE FUNCTION public.booking_activity_uses_participant_units(p_activity_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.booking_activity_counts_participants(p_activity_id)
      OR public.booking_activity_counts_all_participants(p_activity_id);
$$;

CREATE OR REPLACE FUNCTION public.booking_count_all_participants(p_booking_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.booking_participants bp
  WHERE bp.booking_id = p_booking_id;
$$;

CREATE OR REPLACE FUNCTION public.booking_occupancy_units_for_booking(
  p_activity_id UUID,
  p_booking_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_source_id UUID;
  v_count INTEGER;
BEGIN
  SELECT b.multi_day_role
  INTO v_role
  FROM public.bookings b
  WHERE b.id = p_booking_id;

  IF v_role = 'parent' THEN
    RETURN 0;
  END IF;

  v_source_id := public.booking_participant_source_id(p_booking_id);

  IF public.booking_activity_counts_all_participants(p_activity_id) THEN
    v_count := public.booking_count_all_participants(v_source_id);
    RETURN GREATEST(1, COALESCE(v_count, 0));
  END IF;

  IF public.booking_activity_counts_participants(p_activity_id) THEN
    v_count := public.booking_count_capacity_participants(v_source_id);
    RETURN COALESCE(v_count, 0);
  END IF;

  RETURN 1;
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
  IF public.booking_activity_uses_participant_units(p_activity_id) THEN
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
BEGIN
  IF public.booking_activity_uses_participant_units(p_activity_id) THEN
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

CREATE OR REPLACE FUNCTION public.booking_type_counts_participants(p_type_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(bt.type_key, '') IN ('day_camp', 'drop_in_play')
  FROM public.booking_types bt
  WHERE bt.id = p_type_id;
$$;

COMMENT ON FUNCTION public.booking_activity_counts_all_participants(UUID) IS
  'True when every booking_participants row consumes a schedule seat (drop-in play).';

COMMENT ON FUNCTION public.booking_activity_uses_participant_units(UUID) IS
  'True when slot occupancy sums participant units instead of booking rows.';

COMMENT ON FUNCTION public.booking_count_all_participants(UUID) IS
  'All attendee rows on a booking (drop-in capacity).';

COMMENT ON FUNCTION public.booking_occupancy_units_for_booking(UUID, UUID) IS
  'Occupied units: all attendees for drop-in, campers for day camp, else 1 booking.';

GRANT EXECUTE ON FUNCTION public.booking_activity_counts_all_participants(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_activity_uses_participant_units(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_count_all_participants(UUID) TO anon, authenticated, service_role;
