-- Browser punch clock uses an isolated Supabase client (anon). scheduling_time_clocks has RLS
-- "Authenticated business access" (20260309120000_supabase_security_advisor_fixes.sql), so anon
-- direct INSERT/UPDATE fails. These SECURITY DEFINER RPCs re-check PIN then mutate rows.

ALTER TABLE public.scheduling_break_tracking
  ADD COLUMN IF NOT EXISTS photo_url_start TEXT;
ALTER TABLE public.scheduling_break_tracking
  ADD COLUMN IF NOT EXISTS photo_url_end TEXT;

-- -----------------------------------------------------------------------------
-- After PIN: active open clock + active open break (one round trip for kiosk load)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.time_clock_kiosk_after_pin_bootstrap(
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
  v_clock public.scheduling_time_clocks%ROWTYPE;
  v_break public.scheduling_break_tracking%ROWTYPE;
  v_clock_json jsonb;
  v_break_json jsonb;
BEGIN
  IF p_business_id IS NULL OR p_pin IS NULL OR length(trim(p_pin)) = 0 THEN
    RETURN jsonb_build_object('activeClock', NULL, 'activeBreak', NULL);
  END IF;

  SELECT t.id
  INTO v_employee_id
  FROM public.time_clock_kiosk_verify_pin(p_business_id, p_pin) AS t(id, full_name, email)
  LIMIT 1;

  IF v_employee_id IS NULL THEN
    RETURN jsonb_build_object('activeClock', NULL, 'activeBreak', NULL);
  END IF;

  SELECT *
  INTO v_clock
  FROM public.scheduling_time_clocks tc
  WHERE tc.employee_id = v_employee_id
    AND tc.business_id = p_business_id
    AND tc.clock_out_time IS NULL
  ORDER BY tc.clock_in_time DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('activeClock', NULL, 'activeBreak', NULL);
  END IF;

  v_clock_json := to_jsonb(v_clock);

  SELECT *
  INTO v_break
  FROM public.scheduling_break_tracking bt
  WHERE bt.employee_id = v_employee_id
    AND bt.business_id = p_business_id
    AND bt.time_clock_id = v_clock.id
    AND bt.break_end_at IS NULL
  LIMIT 1;

  IF FOUND THEN
    v_break_json := to_jsonb(v_break);
  ELSE
    v_break_json := NULL;
  END IF;

  RETURN jsonb_build_object('activeClock', v_clock_json, 'activeBreak', v_break_json);
END;
$$;

REVOKE ALL ON FUNCTION public.time_clock_kiosk_after_pin_bootstrap(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_after_pin_bootstrap(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_after_pin_bootstrap(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.time_clock_kiosk_after_pin_bootstrap(uuid, text) IS
  'Kiosk anon: returns active open time clock row and active open break row JSON (or nulls) after PIN verification.';

-- -----------------------------------------------------------------------------
-- Clock in
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.time_clock_kiosk_clock_in(
  p_business_id uuid,
  p_pin text,
  p_clock_in_time timestamptz DEFAULT now()
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
  IF p_business_id IS NULL OR p_pin IS NULL OR length(trim(p_pin)) = 0 THEN
    RAISE EXCEPTION 'Invalid arguments' USING ERRCODE = '22023';
  END IF;

  SELECT t.id
  INTO v_employee_id
  FROM public.time_clock_kiosk_verify_pin(p_business_id, p_pin) AS t(id, full_name, email)
  LIMIT 1;

  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Invalid PIN' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.scheduling_time_clocks (employee_id, business_id, clock_in_time)
  VALUES (v_employee_id, p_business_id, p_clock_in_time)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.time_clock_kiosk_clock_in(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_clock_in(uuid, text, timestamptz) TO anon;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_clock_in(uuid, text, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.time_clock_kiosk_clock_in(uuid, text, timestamptz) IS
  'Kiosk anon: clock in after PIN verification; returns new scheduling_time_clocks.id.';

-- -----------------------------------------------------------------------------
-- Clock out (active open row for employee + business)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.time_clock_kiosk_clock_out(
  p_business_id uuid,
  p_pin text,
  p_clock_out_time timestamptz DEFAULT now()
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
  IF p_business_id IS NULL OR p_pin IS NULL OR length(trim(p_pin)) = 0 THEN
    RAISE EXCEPTION 'Invalid arguments' USING ERRCODE = '22023';
  END IF;

  SELECT t.id
  INTO v_employee_id
  FROM public.time_clock_kiosk_verify_pin(p_business_id, p_pin) AS t(id, full_name, email)
  LIMIT 1;

  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Invalid PIN' USING ERRCODE = 'P0001';
  END IF;

  SELECT tc.id,
    round(
      (EXTRACT(EPOCH FROM (p_clock_out_time - tc.clock_in_time)) / 3600.0)::numeric,
      2
    )
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

REVOKE ALL ON FUNCTION public.time_clock_kiosk_clock_out(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_clock_out(uuid, text, timestamptz) TO anon;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_clock_out(uuid, text, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.time_clock_kiosk_clock_out(uuid, text, timestamptz) IS
  'Kiosk anon: clock out active row after PIN verification.';

-- -----------------------------------------------------------------------------
-- Photo URL on scheduling_time_clocks (post-upload)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.time_clock_kiosk_set_time_clock_photo(
  p_business_id uuid,
  p_pin text,
  p_time_clock_id uuid,
  p_column_name text,
  p_photo_url text
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
  IF p_business_id IS NULL OR p_pin IS NULL OR p_time_clock_id IS NULL OR p_column_name IS NULL THEN
    RAISE EXCEPTION 'Invalid arguments' USING ERRCODE = '22023';
  END IF;

  IF p_column_name NOT IN ('photo_verification_url', 'clock_out_photo_url') THEN
    RAISE EXCEPTION 'Invalid column' USING ERRCODE = '22023';
  END IF;

  SELECT t.id
  INTO v_employee_id
  FROM public.time_clock_kiosk_verify_pin(p_business_id, p_pin) AS t(id, full_name, email)
  LIMIT 1;

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

REVOKE ALL ON FUNCTION public.time_clock_kiosk_set_time_clock_photo(uuid, text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_set_time_clock_photo(uuid, text, uuid, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_set_time_clock_photo(uuid, text, uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.time_clock_kiosk_set_time_clock_photo(uuid, text, uuid, text, text) IS
  'Kiosk anon: set photo_verification_url or clock_out_photo_url after PIN + row ownership check.';

-- -----------------------------------------------------------------------------
-- Notes on most recent clock-out row for this employee (kiosk comment modal)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.time_clock_kiosk_set_notes_latest_clock_out(
  p_business_id uuid,
  p_pin text,
  p_notes text
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
  IF p_business_id IS NULL OR p_pin IS NULL OR p_notes IS NULL THEN
    RAISE EXCEPTION 'Invalid arguments' USING ERRCODE = '22023';
  END IF;

  SELECT t.id
  INTO v_employee_id
  FROM public.time_clock_kiosk_verify_pin(p_business_id, p_pin) AS t(id, full_name, email)
  LIMIT 1;

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

REVOKE ALL ON FUNCTION public.time_clock_kiosk_set_notes_latest_clock_out(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_set_notes_latest_clock_out(uuid, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_set_notes_latest_clock_out(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.time_clock_kiosk_set_notes_latest_clock_out(uuid, text, text) IS
  'Kiosk anon: set notes on the latest clock-out row for PIN-verified employee.';

-- -----------------------------------------------------------------------------
-- Break: start / end / break photo (same anon RLS issue may apply later)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.time_clock_kiosk_start_break(
  p_business_id uuid,
  p_pin text,
  p_notes text DEFAULT 'Break started via kiosk'
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
  IF p_business_id IS NULL OR p_pin IS NULL THEN
    RAISE EXCEPTION 'Invalid arguments' USING ERRCODE = '22023';
  END IF;

  SELECT t.id
  INTO v_employee_id
  FROM public.time_clock_kiosk_verify_pin(p_business_id, p_pin) AS t(id, full_name, email)
  LIMIT 1;

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
    SELECT 1
    FROM public.scheduling_break_tracking bt
    WHERE bt.time_clock_id = v_clock_id
      AND bt.break_end_at IS NULL
  ) THEN
    RAISE EXCEPTION 'There is already an active break' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.scheduling_break_tracking (
    business_id,
    employee_id,
    time_clock_id,
    break_start_at,
    notes
  )
  VALUES (
    p_business_id,
    v_employee_id,
    v_clock_id,
    now(),
    coalesce(nullif(trim(p_notes), ''), 'Break started via kiosk')
  )
  RETURNING id INTO v_break_id;

  RETURN v_break_id;
END;
$$;

REVOKE ALL ON FUNCTION public.time_clock_kiosk_start_break(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_start_break(uuid, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_start_break(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.time_clock_kiosk_end_break(
  p_business_id uuid,
  p_pin text,
  p_break_id uuid,
  p_break_end_at timestamptz DEFAULT now()
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
  IF p_business_id IS NULL OR p_pin IS NULL OR p_break_id IS NULL THEN
    RAISE EXCEPTION 'Invalid arguments' USING ERRCODE = '22023';
  END IF;

  SELECT t.id
  INTO v_employee_id
  FROM public.time_clock_kiosk_verify_pin(p_business_id, p_pin) AS t(id, full_name, email)
  LIMIT 1;

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

REVOKE ALL ON FUNCTION public.time_clock_kiosk_end_break(uuid, text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_end_break(uuid, text, uuid, timestamptz) TO anon;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_end_break(uuid, text, uuid, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.time_clock_kiosk_set_break_tracking_photo(
  p_business_id uuid,
  p_pin text,
  p_break_id uuid,
  p_column_name text,
  p_photo_url text
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
  IF p_business_id IS NULL OR p_pin IS NULL OR p_break_id IS NULL OR p_column_name IS NULL THEN
    RAISE EXCEPTION 'Invalid arguments' USING ERRCODE = '22023';
  END IF;

  IF p_column_name NOT IN ('photo_url_start', 'photo_url_end') THEN
    RAISE EXCEPTION 'Invalid column' USING ERRCODE = '22023';
  END IF;

  SELECT t.id
  INTO v_employee_id
  FROM public.time_clock_kiosk_verify_pin(p_business_id, p_pin) AS t(id, full_name, email)
  LIMIT 1;

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

REVOKE ALL ON FUNCTION public.time_clock_kiosk_set_break_tracking_photo(uuid, text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_set_break_tracking_photo(uuid, text, uuid, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_set_break_tracking_photo(uuid, text, uuid, text, text) TO authenticated;
