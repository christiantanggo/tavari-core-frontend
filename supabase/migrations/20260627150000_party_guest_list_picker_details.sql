-- Enrich party guest list booking picker with time and birthday child name.

DROP FUNCTION IF EXISTS public.party_guest_list_find_bookings_by_phone(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.party_guest_list_find_bookings_by_phone(
  p_business_id UUID,
  p_phone_number TEXT
)
RETURNS TABLE (
  booking_id UUID,
  booking_number TEXT,
  booking_date DATE,
  booking_time TIME,
  booking_end_time TIME,
  activity_name TEXT,
  duration_minutes INT,
  customer_name TEXT,
  birthday_child_name TEXT,
  guest_list_id UUID,
  guest_list_status TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id AS booking_id,
    b.booking_number,
    b.booking_date,
    b.booking_time,
    b.booking_end_time,
    COALESCE(ba.activity_name, 'Party') AS activity_name,
    ba.duration_minutes,
    TRIM(COALESCE(pl.customer_name, '')) AS customer_name,
    (
      SELECT NULLIF(TRIM(CONCAT(
        COALESCE(
          NULLIF(TRIM(bcp.first_name), ''),
          NULLIF(TRIM(wp.first_name), ''),
          NULLIF(TRIM(ws.first_name), ''),
          ''
        ),
        ' ',
        COALESCE(
          NULLIF(TRIM(bcp.last_name), ''),
          NULLIF(TRIM(wp.last_name), ''),
          NULLIF(TRIM(ws.last_name), ''),
          ''
        )
      )), '')
      FROM public.booking_participants bp
      LEFT JOIN public.booking_customer_participants bcp ON bcp.id = bp.participant_id
      LEFT JOIN public.waiver_participants wp ON wp.id = bp.waiver_participant_id
      LEFT JOIN public.waiver_signatures ws ON ws.id = bp.waiver_id
      WHERE bp.booking_id = b.id
        AND bp.party_role = 'birthday_child'
      LIMIT 1
    ) AS birthday_child_name,
    pgl.id AS guest_list_id,
    pgl.status AS guest_list_status
  FROM public.bookings b
  LEFT JOIN public.booking_activities ba ON ba.id = b.activity_id
  LEFT JOIN public.pos_loyalty_accounts pl ON pl.id = b.customer_id
  LEFT JOIN public.party_guest_lists pgl ON pgl.booking_id = b.id AND pgl.business_id = b.business_id
  WHERE b.business_id = p_business_id
    AND b.booking_date >= CURRENT_DATE
    AND b.status NOT IN ('cancelled', 'completed')
    AND public.waiver_otp_phone_digits(b.customer_phone) = public.waiver_otp_phone_digits(p_phone_number)
    AND length(public.waiver_otp_phone_digits(p_phone_number)) >= 10
  ORDER BY b.booking_date ASC, b.booking_time ASC;
$$;

GRANT EXECUTE ON FUNCTION public.party_guest_list_find_bookings_by_phone(UUID, TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.party_guest_list_find_bookings_by_phone IS
  'Public OTP flow: list upcoming bookings for party booker phone (includes time and birthday child).';
