-- Cross-activity party room occupancy for portal availability (anon-readable via SECURITY DEFINER).

CREATE OR REPLACE FUNCTION public.booking_list_day_resource_occupancy(
  p_business_id UUID,
  p_booking_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB := '[]'::jsonb;
BEGIN
  IF p_business_id IS NULL OR p_booking_date IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY booking_time), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', b.id,
      'status', b.status,
      'booking_time', b.booking_time,
      'duration_minutes', COALESCE(
        b.duration_minutes,
        a.duration_minutes,
        90
      ),
      'activity_id', b.activity_id,
      'booking_resource_assignments', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'category_id', bra.category_id,
          'resource_id', bra.resource_id
        ))
        FROM public.booking_resource_assignments bra
        WHERE bra.booking_id = b.id
          AND bra.business_id = b.business_id
      ), '[]'::jsonb)
    ) AS row_data,
    b.booking_time
    FROM public.bookings b
    LEFT JOIN public.booking_activities a
      ON a.id = b.activity_id
     AND a.business_id = b.business_id
    WHERE b.business_id = p_business_id
      AND b.booking_date = p_booking_date
      AND b.status IN ('pending', 'confirmed', 'checked_in')
  ) occupied;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.booking_list_day_resource_occupancy(UUID, DATE)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.booking_list_day_resource_occupancy(UUID, DATE) IS
  'Returns active bookings and resource assignments for a business date (portal cross-package room checks).';
