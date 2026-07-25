-- Multi-day bookings: parent holds payment/participants; day rows appear on each calendar date.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS parent_booking_id UUID REFERENCES public.bookings(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS multi_day_role TEXT;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_multi_day_role_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_multi_day_role_check
  CHECK (multi_day_role IS NULL OR multi_day_role IN ('parent', 'day'));

CREATE INDEX IF NOT EXISTS idx_bookings_parent_booking_id
  ON public.bookings (parent_booking_id)
  WHERE parent_booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_multi_day_role
  ON public.bookings (business_id, multi_day_role)
  WHERE multi_day_role IS NOT NULL;

COMMENT ON COLUMN public.bookings.parent_booking_id IS
  'For multi-day bookings: day rows reference the parent that holds participants and payment.';
COMMENT ON COLUMN public.bookings.multi_day_role IS
  'parent = financial/participant anchor (hidden from schedule slots); day = daily attendance row.';

CREATE OR REPLACE FUNCTION public.booking_participant_source_id(p_booking_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT b.parent_booking_id FROM public.bookings b WHERE b.id = p_booking_id),
    p_booking_id
  );
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

  IF public.booking_activity_counts_participants(p_activity_id) THEN
    SELECT GREATEST(
      1,
      COALESCE((
        SELECT COUNT(*)::INTEGER
        FROM public.booking_participants bp
        WHERE bp.booking_id = v_source_id
      ), 0)
    )
    INTO v_count;
    RETURN v_count;
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
  IF public.booking_activity_counts_participants(p_activity_id) THEN
    SELECT COALESCE(SUM(public.booking_occupancy_units_for_booking(p_activity_id, b.id)), 0)::INTEGER
    INTO v_count
    FROM public.bookings b
    WHERE b.business_id = p_business_id
      AND b.activity_id = p_activity_id
      AND b.booking_date = p_booking_date
      AND b.booking_time::time = p_booking_time::time
      AND b.status IN ('pending', 'confirmed', 'checked_in')
      AND COALESCE(b.multi_day_role, '') <> 'parent'
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
      AND COALESCE(b.multi_day_role, '') <> 'parent'
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
        AND COALESCE(b.multi_day_role, '') <> 'parent'
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
        AND COALESCE(b.multi_day_role, '') <> 'parent'
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

GRANT EXECUTE ON FUNCTION public.booking_participant_source_id(UUID) TO anon, authenticated, service_role;
