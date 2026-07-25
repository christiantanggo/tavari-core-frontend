-- Shared capacity pool per booking category (booking_types), optional daily or per-time-slot cap.
-- Manager override bypasses category cap for a specific calendar day (staff bookings).

CREATE TABLE IF NOT EXISTS public.booking_category_capacity_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  booking_type_id UUID NOT NULL REFERENCES public.booking_types(id) ON DELETE CASCADE,
  booking_date DATE NOT NULL,
  booking_time TIME NULL,
  approved_by UUID NOT NULL REFERENCES public.users(id),
  reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_category_cap_override_daily
  ON public.booking_category_capacity_overrides (business_id, booking_type_id, booking_date)
  WHERE booking_time IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_category_cap_override_slot
  ON public.booking_category_capacity_overrides (business_id, booking_type_id, booking_date, booking_time)
  WHERE booking_time IS NOT NULL;

COMMENT ON TABLE public.booking_category_capacity_overrides IS
  'Staff manager-approved bypass of category shared capacity for a specific day (daily mode) or day+time (time_slot mode).';

ALTER TABLE public.booking_category_capacity_overrides ENABLE ROW LEVEL SECURITY;

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

CREATE OR REPLACE FUNCTION public.booking_parse_category_shared_capacity(p_type_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT bt.session_rules -> 'shared_capacity'
      FROM public.booking_types bt
      WHERE bt.id = p_type_id
    ),
    '{}'::jsonb
  );
$$;

CREATE OR REPLACE FUNCTION public.booking_category_capacity_config(p_type_id UUID)
RETURNS TABLE (
  enabled BOOLEAN,
  capacity_mode TEXT,
  max_capacity INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw JSONB;
  v_mode TEXT;
  v_max INTEGER;
BEGIN
  v_raw := public.booking_parse_category_shared_capacity(p_type_id);
  enabled := COALESCE((v_raw ->> 'enabled')::boolean, false);
  v_mode := lower(COALESCE(v_raw ->> 'mode', 'daily'));
  capacity_mode := CASE WHEN v_mode = 'time_slot' THEN 'time_slot' ELSE 'daily' END;
  v_max := NULLIF(COALESCE(v_raw ->> 'max', v_raw ->> 'max_capacity'), '')::INTEGER;
  max_capacity := CASE WHEN v_max IS NOT NULL AND v_max > 0 THEN v_max ELSE NULL END;
  enabled := enabled AND max_capacity IS NOT NULL;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.booking_category_capacity_bypass_active(
  p_business_id UUID,
  p_type_id UUID,
  p_booking_date DATE,
  p_booking_time TIME DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode TEXT;
BEGIN
  SELECT c.capacity_mode
  INTO v_mode
  FROM public.booking_category_capacity_config(p_type_id) c
  LIMIT 1;

  IF v_mode = 'time_slot' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.booking_category_capacity_overrides o
      WHERE o.business_id = p_business_id
        AND o.booking_type_id = p_type_id
        AND o.booking_date = p_booking_date
        AND (
          o.booking_time IS NULL
          OR o.booking_time::time = p_booking_time::time
        )
    );
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.booking_category_capacity_overrides o
    WHERE o.business_id = p_business_id
      AND o.booking_type_id = p_type_id
      AND o.booking_date = p_booking_date
      AND o.booking_time IS NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.booking_count_category_occupied_units(
  p_business_id UUID,
  p_type_id UUID,
  p_booking_date DATE,
  p_booking_time TIME DEFAULT NULL,
  p_exclude_booking_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode TEXT;
  v_count INTEGER;
BEGIN
  SELECT c.capacity_mode
  INTO v_mode
  FROM public.booking_category_capacity_config(p_type_id) c
  LIMIT 1;

  IF v_mode = 'time_slot' THEN
    SELECT COALESCE(SUM(public.booking_occupancy_units_for_booking(b.activity_id, b.id)), 0)::INTEGER
    INTO v_count
    FROM public.bookings b
    INNER JOIN public.booking_activities ba ON ba.id = b.activity_id
    WHERE b.business_id = p_business_id
      AND ba.type_id = p_type_id
      AND b.booking_date = p_booking_date
      AND b.booking_time::time = p_booking_time::time
      AND b.status IN ('pending', 'confirmed', 'checked_in')
      AND COALESCE(b.multi_day_role, '') <> 'parent'
      AND (p_exclude_booking_id IS NULL OR b.id <> p_exclude_booking_id);
  ELSE
    SELECT COALESCE(SUM(public.booking_occupancy_units_for_booking(b.activity_id, b.id)), 0)::INTEGER
    INTO v_count
    FROM public.bookings b
    INNER JOIN public.booking_activities ba ON ba.id = b.activity_id
    WHERE b.business_id = p_business_id
      AND ba.type_id = p_type_id
      AND b.booking_date = p_booking_date
      AND b.status IN ('pending', 'confirmed', 'checked_in')
      AND COALESCE(b.multi_day_role, '') <> 'parent'
      AND (p_exclude_booking_id IS NULL OR b.id <> p_exclude_booking_id);
  END IF;

  RETURN COALESCE(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.booking_category_capacity_remaining(
  p_business_id UUID,
  p_type_id UUID,
  p_booking_date DATE,
  p_booking_time TIME DEFAULT NULL,
  p_exclude_booking_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg RECORD;
  v_occupied INTEGER;
BEGIN
  SELECT * INTO v_cfg FROM public.booking_category_capacity_config(p_type_id) LIMIT 1;
  IF NOT FOUND OR NOT v_cfg.enabled OR v_cfg.max_capacity IS NULL THEN
    RETURN NULL;
  END IF;

  IF public.booking_category_capacity_bypass_active(
    p_business_id, p_type_id, p_booking_date, p_booking_time
  ) THEN
    RETURN v_cfg.max_capacity;
  END IF;

  v_occupied := public.booking_count_category_occupied_units(
    p_business_id, p_type_id, p_booking_date, p_booking_time, p_exclude_booking_id
  );

  RETURN GREATEST(0, v_cfg.max_capacity - COALESCE(v_occupied, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.booking_effective_slot_capacity(
  p_business_id UUID,
  p_activity_id UUID,
  p_booking_date DATE,
  p_booking_time TIME,
  p_exclude_booking_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type_id UUID;
  v_slot_spaces INTEGER;
  v_slot_occupied INTEGER;
  v_category_remaining INTEGER;
  v_cfg RECORD;
  v_effective INTEGER;
BEGIN
  SELECT ba.type_id INTO v_type_id
  FROM public.booking_activities ba
  WHERE ba.id = p_activity_id;

  v_slot_spaces := public.booking_resolve_schedule_spaces(
    p_business_id, p_activity_id, p_booking_date, p_booking_time
  );

  v_slot_occupied := public.booking_count_slot_occupied_units(
    p_business_id, p_activity_id, p_booking_date, p_booking_time, p_exclude_booking_id
  );

  v_category_remaining := public.booking_category_capacity_remaining(
    p_business_id, v_type_id, p_booking_date, p_booking_time, p_exclude_booking_id
  );

  SELECT * INTO v_cfg FROM public.booking_category_capacity_config(v_type_id) LIMIT 1;

  v_effective := GREATEST(0, v_slot_spaces - COALESCE(v_slot_occupied, 0));
  IF v_category_remaining IS NOT NULL THEN
    v_effective := LEAST(v_effective, v_category_remaining);
  END IF;

  RETURN jsonb_build_object(
    'slot_spaces', v_slot_spaces,
    'slot_occupied', COALESCE(v_slot_occupied, 0),
    'slot_remaining', GREATEST(0, v_slot_spaces - COALESCE(v_slot_occupied, 0)),
    'category_enabled', COALESCE(v_cfg.enabled, false),
    'category_mode', COALESCE(v_cfg.capacity_mode, 'daily'),
    'category_max', v_cfg.max_capacity,
    'category_occupied', CASE
      WHEN COALESCE(v_cfg.enabled, false) THEN public.booking_count_category_occupied_units(
        p_business_id, v_type_id, p_booking_date, p_booking_time, p_exclude_booking_id
      )
      ELSE NULL
    END,
    'category_remaining', v_category_remaining,
    'category_bypass_active', public.booking_category_capacity_bypass_active(
      p_business_id, v_type_id, p_booking_date, p_booking_time
    ),
    'effective_remaining', v_effective
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.booking_validate_category_capacity(
  p_business_id UUID,
  p_activity_id UUID,
  p_booking_date DATE,
  p_booking_time TIME,
  p_units_requested INTEGER DEFAULT 1,
  p_override_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type_id UUID;
  v_cfg RECORD;
  v_units INTEGER;
  v_remaining INTEGER;
  v_override_ok BOOLEAN := false;
BEGIN
  IF p_business_id IS NULL OR p_activity_id IS NULL OR p_booking_date IS NULL OR p_booking_time IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Missing capacity parameters.');
  END IF;

  SELECT ba.type_id INTO v_type_id
  FROM public.booking_activities ba
  WHERE ba.id = p_activity_id AND ba.business_id = p_business_id;

  IF v_type_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Activity not found.');
  END IF;

  SELECT * INTO v_cfg FROM public.booking_category_capacity_config(v_type_id) LIMIT 1;
  IF NOT COALESCE(v_cfg.enabled, false) OR v_cfg.max_capacity IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'category_limited', false);
  END IF;

  IF p_override_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.booking_category_capacity_overrides o
      WHERE o.id = p_override_id
        AND o.business_id = p_business_id
        AND o.booking_type_id = v_type_id
        AND o.booking_date = p_booking_date
    ) INTO v_override_ok;
  END IF;

  IF v_override_ok OR public.booking_category_capacity_bypass_active(
    p_business_id, v_type_id, p_booking_date, p_booking_time
  ) THEN
    RETURN jsonb_build_object('ok', true, 'category_limited', true, 'bypass_active', true);
  END IF;

  v_units := GREATEST(1, COALESCE(p_units_requested, 1));
  v_remaining := public.booking_category_capacity_remaining(
    p_business_id, v_type_id, p_booking_date, p_booking_time, NULL
  );

  IF v_remaining IS NULL OR v_units <= v_remaining THEN
    RETURN jsonb_build_object(
      'ok', true,
      'category_limited', true,
      'category_remaining', v_remaining,
      'category_max', v_cfg.max_capacity
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', false,
    'code', 'category_capacity',
    'requires_override', true,
    'message', format(
      'Category capacity reached (%s of %s %s). A manager PIN is required to override for this date.',
      COALESCE(v_cfg.max_capacity, 0) - COALESCE(v_remaining, 0),
      v_cfg.max_capacity,
      CASE WHEN v_cfg.capacity_mode = 'time_slot' THEN 'for this time slot' ELSE 'for this day' END
    ),
    'category_max', v_cfg.max_capacity,
    'category_remaining', v_remaining,
    'category_mode', v_cfg.capacity_mode
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.booking_record_category_capacity_override(
  p_business_id UUID,
  p_booking_type_id UUID,
  p_booking_date DATE,
  p_booking_time TIME DEFAULT NULL,
  p_approved_by UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg RECORD;
  v_row public.booking_category_capacity_overrides;
  v_time TIME;
BEGIN
  IF p_business_id IS NULL OR p_booking_type_id IS NULL OR p_booking_date IS NULL OR p_approved_by IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Missing override parameters.');
  END IF;

  SELECT * INTO v_cfg FROM public.booking_category_capacity_config(p_booking_type_id) LIMIT 1;
  IF NOT COALESCE(v_cfg.enabled, false) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Category shared capacity is not enabled.');
  END IF;

  IF v_cfg.capacity_mode = 'time_slot' THEN
    v_time := p_booking_time;
  ELSE
    v_time := NULL;
  END IF;

  INSERT INTO public.booking_category_capacity_overrides (
    business_id,
    booking_type_id,
    booking_date,
    booking_time,
    approved_by,
    reason
  ) VALUES (
    p_business_id,
    p_booking_type_id,
    p_booking_date,
    v_time,
    p_approved_by,
    NULLIF(trim(COALESCE(p_reason, '')), '')
  )
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    SELECT * INTO v_row
    FROM public.booking_category_capacity_overrides o
    WHERE o.business_id = p_business_id
      AND o.booking_type_id = p_booking_type_id
      AND o.booking_date = p_booking_date
      AND (
        (v_time IS NULL AND o.booking_time IS NULL)
        OR (v_time IS NOT NULL AND o.booking_time::time = v_time::time)
      )
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'override_id', v_row.id,
    'booking_date', v_row.booking_date,
    'booking_time', v_row.booking_time
  );
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
  v_ctx JSONB;
  v_effective INTEGER;
  v_holds INTEGER;
  v_requested INTEGER;
  v_expires_at TIMESTAMPTZ;
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

  v_ctx := public.booking_effective_slot_capacity(
    p_business_id, p_activity_id, p_booking_date, p_booking_time, NULL
  );

  v_effective := GREATEST(0, COALESCE((v_ctx ->> 'effective_remaining')::INTEGER, 0));

  v_holds := public.booking_count_active_slot_holds(
    p_business_id, p_activity_id, p_booking_date, p_booking_time, p_hold_token
  );

  v_requested := GREATEST(1, COALESCE(p_spaces_requested, 1));

  IF (COALESCE(v_holds, 0) + v_requested) > v_effective THEN
    RETURN jsonb_build_object(
      'ok', false,
      'message', CASE
        WHEN COALESCE((v_ctx ->> 'category_enabled')::boolean, false)
          AND COALESCE((v_ctx ->> 'category_remaining')::INTEGER, 999999) <= COALESCE((v_ctx ->> 'slot_remaining')::INTEGER, 999999)
        THEN 'This category is at capacity for this date. Please choose another day or activity.'
        ELSE 'This time slot was just taken. Please choose another time.'
      END,
      'capacity', v_ctx
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
    'idle_seconds', 120,
    'capacity', v_ctx
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.booking_type_counts_participants(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_parse_category_shared_capacity(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_category_capacity_config(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_category_capacity_bypass_active(UUID, UUID, DATE, TIME) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_count_category_occupied_units(UUID, UUID, DATE, TIME, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_category_capacity_remaining(UUID, UUID, DATE, TIME, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_effective_slot_capacity(UUID, UUID, DATE, TIME, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_validate_category_capacity(UUID, UUID, DATE, TIME, INTEGER, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_record_category_capacity_override(UUID, UUID, DATE, TIME, UUID, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_acquire_slot_hold(UUID, UUID, DATE, TIME, TEXT, UUID, INTEGER) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.booking_count_category_occupied_units(UUID, UUID, DATE, TIME, UUID) IS
  'Sum occupied units across all activities in a category for daily or time-slot shared capacity.';

COMMENT ON FUNCTION public.booking_effective_slot_capacity(UUID, UUID, DATE, TIME, UUID) IS
  'Min(slot remaining, category pool remaining) for portal and staff availability display.';

COMMENT ON FUNCTION public.booking_validate_category_capacity(UUID, UUID, DATE, TIME, INTEGER, UUID) IS
  'Returns ok:false with requires_override when category shared cap would be exceeded.';
