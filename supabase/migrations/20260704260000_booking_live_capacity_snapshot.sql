-- Live capacity snapshot: on-site checked-in units + category pool for public website messaging.

CREATE OR REPLACE FUNCTION public.booking_get_live_on_site_units(
  p_business_id UUID,
  p_type_id UUID,
  p_booking_date DATE
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(public.booking_occupancy_units_for_booking(b.activity_id, b.id)), 0)::INTEGER
  FROM public.bookings b
  INNER JOIN public.booking_activities ba ON ba.id = b.activity_id
  WHERE b.business_id = p_business_id
    AND ba.type_id = p_type_id
    AND b.booking_date = p_booking_date
    AND b.status = 'checked_in'
    AND COALESCE(b.multi_day_role, '') <> 'parent';
$$;

GRANT EXECUTE ON FUNCTION public.booking_get_live_on_site_units(UUID, UUID, DATE) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.booking_get_live_on_site_units IS
  'Checked-in participant units on-site today for a booking category (live walk-in capacity).';

CREATE OR REPLACE FUNCTION public.booking_get_live_capacity_snapshot(
  p_business_id UUID,
  p_booking_date DATE,
  p_type_key TEXT DEFAULT 'drop_in_play'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type_id UUID;
  v_activity_id UUID;
  v_on_site INTEGER;
  v_scheduled INTEGER;
  v_cfg RECORD;
  v_remaining INTEGER;
BEGIN
  SELECT bt.id
  INTO v_type_id
  FROM public.booking_types bt
  WHERE bt.business_id = p_business_id
    AND bt.type_key = COALESCE(NULLIF(trim(p_type_key), ''), 'drop_in_play')
    AND bt.is_active = true
  ORDER BY bt.type_name
  LIMIT 1;

  IF v_type_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'type_not_found');
  END IF;

  SELECT ba.id
  INTO v_activity_id
  FROM public.booking_activities ba
  WHERE ba.business_id = p_business_id
    AND ba.type_id = v_type_id
    AND ba.is_active = true
    AND ba.portal_visible = true
  ORDER BY ba.activity_name
  LIMIT 1;

  v_on_site := public.booking_get_live_on_site_units(p_business_id, v_type_id, p_booking_date);
  v_scheduled := public.booking_count_category_occupied_units(
    p_business_id, v_type_id, p_booking_date, NULL, NULL
  );

  SELECT * INTO v_cfg FROM public.booking_category_capacity_config(v_type_id) LIMIT 1;
  v_remaining := public.booking_category_capacity_remaining(
    p_business_id, v_type_id, p_booking_date, NULL, NULL
  );

  RETURN jsonb_build_object(
    'ok', true,
    'typeId', v_type_id,
    'typeKey', COALESCE(NULLIF(trim(p_type_key), ''), 'drop_in_play'),
    'activityId', v_activity_id,
    'onSiteUnits', COALESCE(v_on_site, 0),
    'scheduledUnitsToday', COALESCE(v_scheduled, 0),
    'categoryCapacityEnabled', COALESCE(v_cfg.enabled, false),
    'categoryMaxCapacity', v_cfg.max_capacity,
    'categoryRemaining', v_remaining
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.booking_get_live_capacity_snapshot(UUID, DATE, TEXT) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.booking_get_live_capacity_snapshot IS
  'Live drop-in capacity snapshot for public website APIs (on-site + category pool).';
