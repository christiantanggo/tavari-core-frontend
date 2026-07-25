-- Capacity counts campers/children only — not adult chaperones or party hosts.

CREATE OR REPLACE FUNCTION public.booking_participant_row_counts_toward_capacity(
  p_booking_participant_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN bp.id IS NULL THEN false
    WHEN COALESCE(bp.party_role, '') = 'host_adult' THEN false
    WHEN LOWER(COALESCE(wp.participant_type, '')) IN ('minor', 'child') THEN true
    WHEN LOWER(COALESCE(wp.participant_type, '')) IN ('primary', 'adult', 'additional_adult', 'additionaladult') THEN false
    WHEN bp.waiver_participant_id IS NOT NULL AND wp.id IS NOT NULL THEN true
    WHEN bp.inventory_item_id IS NOT NULL
      AND COALESCE(pi.name, '') ~* '(^|[^a-z])adult([^a-z]|$)|additional adult|chaperone' THEN false
    WHEN bp.inventory_item_id IS NOT NULL THEN true
    ELSE false
  END
  FROM public.booking_participants bp
  LEFT JOIN public.waiver_participants wp ON wp.id = bp.waiver_participant_id
  LEFT JOIN public.pos_inventory pi ON pi.id = bp.inventory_item_id
  WHERE bp.id = p_booking_participant_id;
$$;

CREATE OR REPLACE FUNCTION public.booking_count_capacity_participants(p_booking_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.booking_participants bp
  WHERE bp.booking_id = p_booking_id
    AND public.booking_participant_row_counts_toward_capacity(bp.id);
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
    v_count := public.booking_count_capacity_participants(v_source_id);
    RETURN COALESCE(v_count, 0);
  END IF;

  RETURN 1;
END;
$$;

COMMENT ON FUNCTION public.booking_participant_row_counts_toward_capacity(UUID) IS
  'True when a booking_participants row consumes one schedule seat (campers/children, not adults).';

COMMENT ON FUNCTION public.booking_count_capacity_participants(UUID) IS
  'Count of capacity-consuming participants on a booking (excludes adult chaperones).';

GRANT EXECUTE ON FUNCTION public.booking_participant_row_counts_toward_capacity(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_count_capacity_participants(UUID) TO anon, authenticated, service_role;
