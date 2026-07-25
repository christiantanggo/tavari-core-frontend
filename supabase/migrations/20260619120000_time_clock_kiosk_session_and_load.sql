-- Punch clock perf: verify bcrypt PIN once per flow, reuse session token for clock in/out/photos.
-- Also adds one-round-trip load_session (employee + active clock/break + settings + today's shifts).

CREATE TABLE IF NOT EXISTS public.time_clock_kiosk_sessions (
  token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '20 minutes')
);

CREATE INDEX IF NOT EXISTS idx_time_clock_kiosk_sessions_expires
  ON public.time_clock_kiosk_sessions (expires_at);

CREATE INDEX IF NOT EXISTS idx_time_clock_kiosk_sessions_business_employee
  ON public.time_clock_kiosk_sessions (business_id, employee_id);

ALTER TABLE public.time_clock_kiosk_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.time_clock_kiosk_sessions FROM PUBLIC;

-- Drop expired sessions opportunistically.
CREATE OR REPLACE FUNCTION public.time_clock_kiosk_purge_expired_sessions()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.time_clock_kiosk_sessions WHERE expires_at <= now();
$$;

CREATE OR REPLACE FUNCTION public.time_clock_kiosk_create_session(
  p_business_id uuid,
  p_employee_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token uuid;
BEGIN
  PERFORM public.time_clock_kiosk_purge_expired_sessions();

  INSERT INTO public.time_clock_kiosk_sessions (business_id, employee_id, expires_at)
  VALUES (p_business_id, p_employee_id, now() + interval '20 minutes')
  RETURNING token INTO v_token;

  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.time_clock_kiosk_employee_from_session(
  p_business_id uuid,
  p_session_token uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id uuid;
BEGIN
  IF p_business_id IS NULL OR p_session_token IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM public.time_clock_kiosk_purge_expired_sessions();

  SELECT s.employee_id
  INTO v_employee_id
  FROM public.time_clock_kiosk_sessions s
  WHERE s.token = p_session_token
    AND s.business_id = p_business_id
    AND s.expires_at > now()
  LIMIT 1;

  RETURN v_employee_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.time_clock_kiosk_employee_from_pin_or_session(
  p_business_id uuid,
  p_pin text DEFAULT NULL,
  p_session_token uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id uuid;
BEGIN
  IF p_session_token IS NOT NULL THEN
    v_employee_id := public.time_clock_kiosk_employee_from_session(p_business_id, p_session_token);
    IF v_employee_id IS NOT NULL THEN
      RETURN v_employee_id;
    END IF;
  END IF;

  IF p_pin IS NULL OR length(trim(p_pin)) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT t.id
  INTO v_employee_id
  FROM public.time_clock_kiosk_verify_pin(p_business_id, p_pin) AS t(id, full_name, email)
  LIMIT 1;

  RETURN v_employee_id;
END;
$$;

-- One round trip after PIN: verify once, issue session, return everything the kiosk UI needs.
CREATE OR REPLACE FUNCTION public.time_clock_kiosk_load_session(
  p_business_id uuid,
  p_pin text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id uuid;
  v_full_name text;
  v_email text;
  v_token uuid;
  v_tz text;
  v_today date;
  v_allow_unscheduled boolean := true;
  v_clock public.scheduling_time_clocks%ROWTYPE;
  v_break public.scheduling_break_tracking%ROWTYPE;
  v_shifts jsonb;
  v_has_clock boolean := false;
BEGIN
  IF p_business_id IS NULL OR p_pin IS NULL OR length(trim(p_pin)) = 0 THEN
    RETURN jsonb_build_object('error', 'invalid_arguments');
  END IF;

  SELECT t.id, COALESCE(t.full_name, ''), COALESCE(t.email, '')
  INTO v_employee_id, v_full_name, v_email
  FROM public.time_clock_kiosk_verify_pin(p_business_id, p_pin) AS t(id, full_name, email)
  LIMIT 1;

  IF v_employee_id IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_pin');
  END IF;

  v_token := public.time_clock_kiosk_create_session(p_business_id, v_employee_id);

  SELECT COALESCE(b.timezone, 'America/Toronto')
  INTO v_tz
  FROM public.businesses b
  WHERE b.id = p_business_id;

  IF v_tz IS NULL THEN
    v_tz := 'America/Toronto';
  END IF;

  v_today := ((now() AT TIME ZONE v_tz))::date;

  SELECT ss.allow_unscheduled_clock_in
  INTO v_allow_unscheduled
  FROM public.scheduling_settings ss
  WHERE ss.business_id = p_business_id
  LIMIT 1;

  IF v_allow_unscheduled IS NULL THEN
    v_allow_unscheduled := true;
  END IF;

  SELECT *
  INTO v_clock
  FROM public.scheduling_time_clocks tc
  WHERE tc.employee_id = v_employee_id
    AND tc.business_id = p_business_id
    AND tc.clock_out_time IS NULL
  ORDER BY tc.clock_in_time DESC
  LIMIT 1;

  v_has_clock := FOUND;

  IF v_has_clock THEN
    SELECT *
    INTO v_break
    FROM public.scheduling_break_tracking bt
    WHERE bt.employee_id = v_employee_id
      AND bt.business_id = p_business_id
      AND bt.time_clock_id = v_clock.id
      AND bt.break_end_at IS NULL
    LIMIT 1;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.start_time), '[]'::jsonb)
  INTO v_shifts
  FROM public.scheduling_shifts s
  WHERE s.employee_id = v_employee_id
    AND s.business_id = p_business_id
    AND s.shift_date = v_today
    AND COALESCE(s.status, 'scheduled') = 'scheduled';

  RETURN jsonb_build_object(
    'sessionToken', v_token,
    'employee', jsonb_build_object(
      'id', v_employee_id,
      'full_name', v_full_name,
      'email', v_email
    ),
    'timezone', v_tz,
    'allowUnscheduled', v_allow_unscheduled,
    'activeClock', CASE WHEN v_has_clock THEN to_jsonb(v_clock) ELSE NULL END,
    'activeBreak', CASE WHEN v_has_clock AND v_break.id IS NOT NULL THEN to_jsonb(v_break) ELSE NULL END,
    'shifts', COALESCE(v_shifts, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.time_clock_kiosk_load_session(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_load_session(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_load_session(uuid, text) TO authenticated;

-- Drop prior 3/5-arg signatures so PostgREST resolves the session-aware versions.
DROP FUNCTION IF EXISTS public.time_clock_kiosk_clock_in(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.time_clock_kiosk_clock_out(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.time_clock_kiosk_set_time_clock_photo(uuid, text, uuid, text, text);
DROP FUNCTION IF EXISTS public.time_clock_kiosk_set_notes_latest_clock_out(uuid, text, text);
DROP FUNCTION IF EXISTS public.time_clock_kiosk_start_break(uuid, text, text);
DROP FUNCTION IF EXISTS public.time_clock_kiosk_end_break(uuid, text, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.time_clock_kiosk_set_break_tracking_photo(uuid, text, uuid, text, text);

-- Re-create mutating RPCs to accept optional session token (skip bcrypt re-check).
CREATE OR REPLACE FUNCTION public.time_clock_kiosk_clock_in(
  p_business_id uuid,
  p_pin text DEFAULT NULL,
  p_clock_in_time timestamptz DEFAULT now(),
  p_session_token uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id uuid;
  v_new_id uuid;
BEGIN
  v_employee_id := public.time_clock_kiosk_employee_from_pin_or_session(p_business_id, p_pin, p_session_token);
  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Invalid PIN' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.scheduling_time_clocks (employee_id, business_id, clock_in_time)
  VALUES (v_employee_id, p_business_id, p_clock_in_time)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.time_clock_kiosk_clock_out(
  p_business_id uuid,
  p_pin text DEFAULT NULL,
  p_clock_out_time timestamptz DEFAULT now(),
  p_session_token uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id uuid;
  v_clock_id uuid;
  v_total numeric;
BEGIN
  v_employee_id := public.time_clock_kiosk_employee_from_pin_or_session(p_business_id, p_pin, p_session_token);
  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Invalid PIN' USING ERRCODE = 'P0001';
  END IF;

  SELECT tc.id,
    round((EXTRACT(EPOCH FROM (p_clock_out_time - tc.clock_in_time)) / 3600.0)::numeric, 2)
  INTO v_clock_id, v_total
  FROM public.scheduling_time_clocks tc
  WHERE tc.employee_id = v_employee_id
    AND tc.business_id = p_business_id
    AND tc.clock_out_time IS NULL
  ORDER BY tc.clock_in_time DESC
  LIMIT 1;

  IF v_clock_id IS NULL THEN
    RAISE EXCEPTION 'No active clock' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.scheduling_time_clocks
  SET clock_out_time = p_clock_out_time,
      total_hours = v_total
  WHERE id = v_clock_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.time_clock_kiosk_set_time_clock_photo(
  p_business_id uuid,
  p_time_clock_id uuid,
  p_column_name text,
  p_photo_url text,
  p_pin text DEFAULT NULL,
  p_session_token uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id uuid;
  v_n int;
BEGIN
  IF p_business_id IS NULL OR p_time_clock_id IS NULL OR p_column_name IS NULL THEN
    RAISE EXCEPTION 'Invalid arguments' USING ERRCODE = '22023';
  END IF;

  IF p_column_name NOT IN ('photo_verification_url', 'clock_out_photo_url') THEN
    RAISE EXCEPTION 'Invalid column' USING ERRCODE = '22023';
  END IF;

  v_employee_id := public.time_clock_kiosk_employee_from_pin_or_session(p_business_id, p_pin, p_session_token);
  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Invalid PIN' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.scheduling_time_clocks tc
  SET photo_verification_url = CASE WHEN p_column_name = 'photo_verification_url' THEN p_photo_url ELSE tc.photo_verification_url END,
      clock_out_photo_url = CASE WHEN p_column_name = 'clock_out_photo_url' THEN p_photo_url ELSE tc.clock_out_photo_url END
  WHERE tc.id = p_time_clock_id
    AND tc.business_id = p_business_id
    AND tc.employee_id = v_employee_id;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Time clock row not found' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.time_clock_kiosk_set_notes_latest_clock_out(
  p_business_id uuid,
  p_notes text,
  p_pin text DEFAULT NULL,
  p_session_token uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id uuid;
  v_row_id uuid;
BEGIN
  IF p_business_id IS NULL OR p_notes IS NULL THEN
    RAISE EXCEPTION 'Invalid arguments' USING ERRCODE = '22023';
  END IF;

  v_employee_id := public.time_clock_kiosk_employee_from_pin_or_session(p_business_id, p_pin, p_session_token);
  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Invalid PIN' USING ERRCODE = 'P0001';
  END IF;

  SELECT tc.id
  INTO v_row_id
  FROM public.scheduling_time_clocks tc
  WHERE tc.employee_id = v_employee_id
    AND tc.business_id = p_business_id
    AND tc.clock_out_time IS NOT NULL
  ORDER BY tc.clock_out_time DESC
  LIMIT 1;

  IF v_row_id IS NULL THEN
    RAISE EXCEPTION 'No clock out row' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.scheduling_time_clocks
  SET notes = trim(p_notes)
  WHERE id = v_row_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.time_clock_kiosk_start_break(
  p_business_id uuid,
  p_notes text DEFAULT 'Break started via kiosk',
  p_pin text DEFAULT NULL,
  p_session_token uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id uuid;
  v_clock_id uuid;
  v_break_id uuid;
BEGIN
  v_employee_id := public.time_clock_kiosk_employee_from_pin_or_session(p_business_id, p_pin, p_session_token);
  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Invalid PIN' USING ERRCODE = 'P0001';
  END IF;

  SELECT tc.id
  INTO v_clock_id
  FROM public.scheduling_time_clocks tc
  WHERE tc.employee_id = v_employee_id
    AND tc.business_id = p_business_id
    AND tc.clock_out_time IS NULL
  ORDER BY tc.clock_in_time DESC
  LIMIT 1;

  IF v_clock_id IS NULL THEN
    RAISE EXCEPTION 'No active clock' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.scheduling_break_tracking bt
    WHERE bt.time_clock_id = v_clock_id AND bt.break_end_at IS NULL
  ) THEN
    RAISE EXCEPTION 'There is already an active break' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.scheduling_break_tracking (
    business_id, employee_id, time_clock_id, break_start_at, notes
  )
  VALUES (
    p_business_id, v_employee_id, v_clock_id, now(),
    coalesce(nullif(trim(p_notes), ''), 'Break started via kiosk')
  )
  RETURNING id INTO v_break_id;

  RETURN v_break_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.time_clock_kiosk_end_break(
  p_business_id uuid,
  p_break_id uuid,
  p_break_end_at timestamptz DEFAULT now(),
  p_pin text DEFAULT NULL,
  p_session_token uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id uuid;
  v_start timestamptz;
  v_dur int;
BEGIN
  IF p_business_id IS NULL OR p_break_id IS NULL THEN
    RAISE EXCEPTION 'Invalid arguments' USING ERRCODE = '22023';
  END IF;

  v_employee_id := public.time_clock_kiosk_employee_from_pin_or_session(p_business_id, p_pin, p_session_token);
  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Invalid PIN' USING ERRCODE = 'P0001';
  END IF;

  SELECT bt.break_start_at
  INTO v_start
  FROM public.scheduling_break_tracking bt
  WHERE bt.id = p_break_id
    AND bt.business_id = p_business_id
    AND bt.employee_id = v_employee_id
    AND bt.break_end_at IS NULL;

  IF v_start IS NULL THEN
    RAISE EXCEPTION 'Break not found' USING ERRCODE = 'P0001';
  END IF;

  v_dur := greatest(0, floor(EXTRACT(EPOCH FROM (p_break_end_at - v_start)) / 60.0))::int;

  UPDATE public.scheduling_break_tracking
  SET break_end_at = p_break_end_at,
      duration_minutes = v_dur
  WHERE id = p_break_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.time_clock_kiosk_set_break_tracking_photo(
  p_business_id uuid,
  p_break_id uuid,
  p_column_name text,
  p_photo_url text,
  p_pin text DEFAULT NULL,
  p_session_token uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id uuid;
  v_n int;
BEGIN
  IF p_business_id IS NULL OR p_break_id IS NULL OR p_column_name IS NULL THEN
    RAISE EXCEPTION 'Invalid arguments' USING ERRCODE = '22023';
  END IF;

  IF p_column_name NOT IN ('photo_url_start', 'photo_url_end') THEN
    RAISE EXCEPTION 'Invalid column' USING ERRCODE = '22023';
  END IF;

  v_employee_id := public.time_clock_kiosk_employee_from_pin_or_session(p_business_id, p_pin, p_session_token);
  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Invalid PIN' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.scheduling_break_tracking bt
  SET photo_url_start = CASE WHEN p_column_name = 'photo_url_start' THEN p_photo_url ELSE bt.photo_url_start END,
      photo_url_end = CASE WHEN p_column_name = 'photo_url_end' THEN p_photo_url ELSE bt.photo_url_end END
  WHERE bt.id = p_break_id
    AND bt.business_id = p_business_id
    AND bt.employee_id = v_employee_id;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Break row not found' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.time_clock_kiosk_clock_in(uuid, text, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_clock_in(uuid, text, timestamptz, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_clock_in(uuid, text, timestamptz, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.time_clock_kiosk_clock_out(uuid, text, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_clock_out(uuid, text, timestamptz, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_clock_out(uuid, text, timestamptz, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.time_clock_kiosk_set_time_clock_photo(uuid, uuid, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_set_time_clock_photo(uuid, uuid, text, text, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_set_time_clock_photo(uuid, uuid, text, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.time_clock_kiosk_set_notes_latest_clock_out(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_set_notes_latest_clock_out(uuid, text, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_set_notes_latest_clock_out(uuid, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.time_clock_kiosk_start_break(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_start_break(uuid, text, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_start_break(uuid, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.time_clock_kiosk_end_break(uuid, uuid, timestamptz, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_end_break(uuid, uuid, timestamptz, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_end_break(uuid, uuid, timestamptz, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.time_clock_kiosk_set_break_tracking_photo(uuid, uuid, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_set_break_tracking_photo(uuid, uuid, text, text, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_set_break_tracking_photo(uuid, uuid, text, text, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.time_clock_kiosk_load_session(uuid, text) IS
  'Kiosk: verify PIN once, create session token, return employee + active clock/break + settings + today shifts.';
