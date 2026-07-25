-- OTP verify uses DB clock (now()) and shared phone normalization so production matches employee lookup.
-- Also pads OTP digits so leading-zero codes still match if the client strips them.

CREATE OR REPLACE FUNCTION public.employee_portal_fetch_active_otp(p_phone text, p_otp text)
RETURNS SETOF public.employee_portal_otp
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT o.*
  FROM public.employee_portal_otp o
  WHERE public.employee_portal_phone_digits(coalesce(o.phone_number, ''))
      = public.employee_portal_phone_digits(coalesce(p_phone, ''))
    AND lpad(
      regexp_replace(trim(coalesce(o.otp_code::text, '')), '[^0-9]', '', 'g'),
      6,
      '0'
    ) = lpad(
      regexp_replace(trim(coalesce(p_otp::text, '')), '[^0-9]', '', 'g'),
      6,
      '0'
    )
    AND length(regexp_replace(trim(coalesce(p_otp::text, '')), '[^0-9]', '', 'g')) >= 5
    AND o.is_used = false
    AND o.expires_at > now()
    AND o.attempts < coalesce(o.max_attempts, 5)
  ORDER BY o.created_at DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.employee_portal_fetch_active_otp(text, text)
  IS 'Edge/service-role: resolve active OTP row; expiry uses DB clock; normalized phone + OTP.';

GRANT EXECUTE ON FUNCTION public.employee_portal_fetch_active_otp(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.employee_portal_increment_otp_attempt(p_phone text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.employee_portal_otp o
  SET attempts = o.attempts + 1
  WHERE o.id = (
    SELECT o2.id
    FROM public.employee_portal_otp o2
    WHERE public.employee_portal_phone_digits(coalesce(o2.phone_number, ''))
        = public.employee_portal_phone_digits(coalesce(p_phone, ''))
      AND o2.is_used = false
      AND o2.expires_at > now()
    ORDER BY o2.created_at DESC
    LIMIT 1
  );
END;
$$;

COMMENT ON FUNCTION public.employee_portal_increment_otp_attempt(text)
  IS 'Bump attempts on latest active OTP row for phone (normalized digits).';

GRANT EXECUTE ON FUNCTION public.employee_portal_increment_otp_attempt(text) TO service_role;
