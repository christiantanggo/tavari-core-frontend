-- Temporary slot holds while a customer completes portal checkout (10 min max, 2 min idle).

CREATE TABLE IF NOT EXISTS public.booking_slot_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES public.booking_activities(id) ON DELETE CASCADE,
  booking_date DATE NOT NULL,
  booking_time TIME NOT NULL,
  hold_token TEXT NOT NULL,
  customer_id UUID NULL REFERENCES public.pos_loyalty_accounts(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_slot_holds_slot_active
  ON public.booking_slot_holds (business_id, activity_id, booking_date, booking_time)
  WHERE released_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_slot_holds_token_active
  ON public.booking_slot_holds (hold_token)
  WHERE released_at IS NULL;

COMMENT ON TABLE public.booking_slot_holds IS
  'Short-lived checkout holds so two customers cannot complete the same slot simultaneously.';

ALTER TABLE public.booking_slot_holds ENABLE ROW LEVEL SECURITY;

-- No direct table policies; portal uses SECURITY DEFINER RPCs only.

CREATE OR REPLACE FUNCTION public.booking_release_stale_slot_holds()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.booking_slot_holds
  SET released_at = now()
  WHERE released_at IS NULL
    AND (
      expires_at <= now()
      OR last_activity_at <= now() - interval '2 minutes'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.booking_resolve_schedule_spaces(
  p_business_id UUID,
  p_activity_id UUID,
  p_booking_date DATE,
  p_booking_time TIME
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day_of_week INTEGER;
  v_spaces INTEGER;
BEGIN
  v_day_of_week := EXTRACT(DOW FROM p_booking_date)::INTEGER;

  SELECT COALESCE(MAX(s.spaces), 1)
  INTO v_spaces
  FROM public.booking_activity_schedules s
  WHERE s.business_id = p_business_id
    AND s.activity_id = p_activity_id
    AND s.is_active = true
    AND s.day_of_week = v_day_of_week
    AND s.start_time::time = p_booking_time::time
    AND (
      (s.start_date IS NULL AND s.end_date IS NULL)
      OR (
        (s.start_date IS NULL OR s.start_date <= p_booking_date)
        AND (s.end_date IS NULL OR s.end_date >= p_booking_date)
      )
    );

  IF v_spaces IS NULL OR v_spaces < 1 THEN
    RETURN 1;
  END IF;
  RETURN v_spaces;
END;
$$;

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
  PERFORM public.booking_release_stale_slot_holds();

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
  v_time_key TEXT;
BEGIN
  PERFORM public.booking_release_stale_slot_holds();

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

CREATE OR REPLACE FUNCTION public.booking_acquire_slot_hold(
  p_business_id UUID,
  p_activity_id UUID,
  p_booking_date DATE,
  p_booking_time TIME,
  p_hold_token TEXT,
  p_customer_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_spaces INTEGER;
  v_bookings INTEGER;
  v_holds INTEGER;
  v_expires_at TIMESTAMPTZ;
  v_existing RECORD;
BEGIN
  IF p_business_id IS NULL OR p_activity_id IS NULL OR p_booking_date IS NULL
     OR p_booking_time IS NULL OR COALESCE(trim(p_hold_token), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Missing hold parameters.');
  END IF;

  PERFORM public.booking_release_stale_slot_holds();

  -- Release any previous active hold for this token (customer changed slot).
  UPDATE public.booking_slot_holds
  SET released_at = now()
  WHERE hold_token = p_hold_token
    AND released_at IS NULL;

  v_spaces := public.booking_resolve_schedule_spaces(
    p_business_id, p_activity_id, p_booking_date, p_booking_time
  );

  SELECT COUNT(*)::INTEGER
  INTO v_bookings
  FROM public.bookings b
  WHERE b.business_id = p_business_id
    AND b.activity_id = p_activity_id
    AND b.booking_date = p_booking_date
    AND b.booking_time::time = p_booking_time::time
    AND b.status IN ('pending', 'confirmed', 'checked_in');

  v_holds := public.booking_count_active_slot_holds(
    p_business_id, p_activity_id, p_booking_date, p_booking_time, p_hold_token
  );

  IF (COALESCE(v_bookings, 0) + COALESCE(v_holds, 0)) >= v_spaces THEN
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

CREATE OR REPLACE FUNCTION public.booking_touch_slot_hold(
  p_hold_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hold RECORD;
  v_seconds_remaining INTEGER;
BEGIN
  PERFORM public.booking_release_stale_slot_holds();

  SELECT *
  INTO v_hold
  FROM public.booking_slot_holds
  WHERE hold_token = p_hold_token
    AND released_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_hold.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Hold not found.');
  END IF;

  IF v_hold.expires_at <= now() THEN
    UPDATE public.booking_slot_holds SET released_at = now() WHERE id = v_hold.id;
    RETURN jsonb_build_object('ok', false, 'message', 'Hold expired.', 'reason', 'expired');
  END IF;

  IF v_hold.last_activity_at <= now() - interval '2 minutes' THEN
    UPDATE public.booking_slot_holds SET released_at = now() WHERE id = v_hold.id;
    RETURN jsonb_build_object('ok', false, 'message', 'Hold released due to inactivity.', 'reason', 'idle');
  END IF;

  UPDATE public.booking_slot_holds
  SET last_activity_at = now()
  WHERE id = v_hold.id;

  v_seconds_remaining := GREATEST(
    0,
    EXTRACT(EPOCH FROM (v_hold.expires_at - now()))::INTEGER
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expires_at', v_hold.expires_at,
    'seconds_remaining', v_seconds_remaining,
    'idle_seconds', 120
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.booking_release_slot_hold(
  p_hold_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.booking_slot_holds
  SET released_at = now()
  WHERE hold_token = p_hold_token
    AND released_at IS NULL;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.booking_validate_slot_hold(
  p_hold_token TEXT,
  p_business_id UUID,
  p_activity_id UUID,
  p_booking_date DATE,
  p_booking_time TIME
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hold RECORD;
BEGIN
  PERFORM public.booking_release_stale_slot_holds();

  SELECT *
  INTO v_hold
  FROM public.booking_slot_holds
  WHERE hold_token = p_hold_token
    AND released_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_hold.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Your time slot reservation expired. Please start again.');
  END IF;

  IF v_hold.business_id <> p_business_id
     OR v_hold.activity_id <> p_activity_id
     OR v_hold.booking_date <> p_booking_date
     OR v_hold.booking_time::time <> p_booking_time::time THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Time slot hold does not match this booking.');
  END IF;

  IF v_hold.expires_at <= now() THEN
    UPDATE public.booking_slot_holds SET released_at = now() WHERE id = v_hold.id;
    RETURN jsonb_build_object('ok', false, 'message', 'Your 10-minute reservation expired. Please choose a time again.', 'reason', 'expired');
  END IF;

  IF v_hold.last_activity_at <= now() - interval '2 minutes' THEN
    UPDATE public.booking_slot_holds SET released_at = now() WHERE id = v_hold.id;
    RETURN jsonb_build_object('ok', false, 'message', 'Your reservation was released after 2 minutes of inactivity.', 'reason', 'idle');
  END IF;

  RETURN jsonb_build_object('ok', true, 'expires_at', v_hold.expires_at);
END;
$$;

GRANT EXECUTE ON FUNCTION public.booking_release_stale_slot_holds() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_resolve_schedule_spaces(UUID, UUID, DATE, TIME) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_count_active_slot_holds(UUID, UUID, DATE, TIME, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_get_portal_slot_occupancy(UUID, UUID, DATE, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_acquire_slot_hold(UUID, UUID, DATE, TIME, TEXT, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_touch_slot_hold(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_release_slot_hold(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_validate_slot_hold(TEXT, UUID, UUID, DATE, TIME) TO anon, authenticated, service_role;

ALTER TABLE public.booking_pending_helcim
  ADD COLUMN IF NOT EXISTS slot_hold_token TEXT;

COMMENT ON COLUMN public.booking_pending_helcim.slot_hold_token IS
  'Portal checkout slot hold token validated at payment init and finalize.';
