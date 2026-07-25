-- Customer portal account RPCs for booking self-service.
-- Avoid direct anon reads/writes against pos_loyalty_accounts by using scoped SECURITY DEFINER helpers.

CREATE OR REPLACE FUNCTION public.bookings_get_portal_customer_by_phone(
  p_business_id UUID,
  p_phone_number TEXT
)
RETURNS SETOF public.pos_loyalty_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone TEXT;
BEGIN
  v_phone := public.waiver_otp_phone_digits(p_phone_number);

  RETURN QUERY
  SELECT *
  FROM public.pos_loyalty_accounts
  WHERE business_id = p_business_id
    AND is_active = true
    AND public.waiver_otp_phone_digits(customer_phone) = v_phone
  ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.bookings_get_portal_customer_account(
  p_customer_id UUID,
  p_business_id UUID
)
RETURNS SETOF public.pos_loyalty_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.pos_loyalty_accounts
  WHERE id = p_customer_id
    AND business_id = p_business_id
    AND is_active = true
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.bookings_create_or_get_portal_customer(
  p_business_id UUID,
  p_phone_number TEXT,
  p_email TEXT,
  p_first_name TEXT,
  p_last_name TEXT,
  p_city TEXT DEFAULT NULL
)
RETURNS SETOF public.pos_loyalty_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone TEXT;
  v_email TEXT;
  v_name TEXT;
  v_customer public.pos_loyalty_accounts%ROWTYPE;
BEGIN
  v_phone := public.waiver_otp_phone_digits(p_phone_number);
  v_email := NULLIF(trim(coalesce(p_email, '')), '');
  v_name := NULLIF(trim(concat_ws(' ', trim(coalesce(p_first_name, '')), trim(coalesce(p_last_name, '')))), '');

  IF v_phone = '' OR length(v_phone) < 10 THEN
    RAISE EXCEPTION 'Invalid phone number';
  END IF;

  SELECT *
  INTO v_customer
  FROM public.pos_loyalty_accounts
  WHERE business_id = p_business_id
    AND is_active = true
    AND public.waiver_otp_phone_digits(customer_phone) = v_phone
  ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.pos_loyalty_accounts
    SET customer_email = COALESCE(v_email, customer_email),
        customer_name = COALESCE(v_name, customer_name),
        updated_at = now()
    WHERE id = v_customer.id
    RETURNING * INTO v_customer;

    RETURN NEXT v_customer;
    RETURN;
  END IF;

  INSERT INTO public.pos_loyalty_accounts (
    business_id,
    customer_name,
    customer_email,
    customer_phone,
    is_active,
    balance,
    points,
    total_earned,
    total_spent
  )
  VALUES (
    p_business_id,
    COALESCE(v_name, split_part(COALESCE(v_email, 'Customer'), '@', 1), 'Customer'),
    v_email,
    v_phone,
    true,
    0,
    0,
    0,
    0
  )
  RETURNING * INTO v_customer;

  RETURN NEXT v_customer;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bookings_get_portal_customer_by_phone(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bookings_get_portal_customer_account(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bookings_create_or_get_portal_customer(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
