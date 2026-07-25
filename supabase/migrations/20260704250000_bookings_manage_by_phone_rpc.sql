-- Public OTP manage-booking flow: list bookings by booker phone.

ALTER TABLE public.business_website_links
  ADD COLUMN IF NOT EXISTS manage_booking_url TEXT;

COMMENT ON COLUMN public.business_website_links.manage_booking_url IS
  'Marketing-site URL for manage-booking entry (OTP lookup). Falls back to Tavari host manage-booking portal.';

CREATE OR REPLACE FUNCTION public.bookings_find_manageable_by_phone(
  p_business_id UUID,
  p_phone_number TEXT
)
RETURNS TABLE (
  booking_id UUID,
  booking_number TEXT,
  booking_date DATE,
  booking_time TIME,
  status TEXT,
  payment_status TEXT,
  activity_name TEXT,
  booking_type_name TEXT,
  customer_id UUID,
  customer_name TEXT
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
    b.status,
    b.payment_status,
    COALESCE(ba.activity_name, 'Booking') AS activity_name,
    COALESCE(bt.display_name, bt.type_name, '') AS booking_type_name,
    b.customer_id,
    TRIM(COALESCE(pl.customer_name, '')) AS customer_name
  FROM public.bookings b
  LEFT JOIN public.booking_activities ba ON ba.id = b.activity_id
  LEFT JOIN public.booking_types bt ON bt.id = b.booking_type_id
  LEFT JOIN public.pos_loyalty_accounts pl ON pl.id = b.customer_id
  WHERE b.business_id = p_business_id
    AND b.status NOT IN ('cancelled', 'completed', 'no_show')
    AND b.booking_date >= (CURRENT_DATE - INTERVAL '1 day')
    AND length(public.waiver_otp_phone_digits(p_phone_number)) >= 10
    AND (
      public.waiver_otp_phone_digits(b.customer_phone) = public.waiver_otp_phone_digits(p_phone_number)
      OR public.waiver_otp_phone_digits(pl.customer_phone) = public.waiver_otp_phone_digits(p_phone_number)
    )
  ORDER BY b.booking_date ASC, b.booking_time ASC
  LIMIT 50;
$$;

GRANT EXECUTE ON FUNCTION public.bookings_find_manageable_by_phone(UUID, TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.bookings_find_manageable_by_phone IS
  'Public OTP flow: upcoming/recent manageable bookings for a booker phone.';
