-- OTP delivery rule: if the client passes a non-empty p_email, that address is used — never replaced
-- by pos_loyalty_accounts. Link customer_id only when the same row matches BOTH normalized phone and
-- that email (so OTP is never “for phone X” but sent to an email belonging to another person).

DROP FUNCTION IF EXISTS public.waivers_generate_otp(uuid, text, text, uuid, text, text, boolean);
DROP FUNCTION IF EXISTS public.waivers_generate_otp(uuid, text, text, uuid, text, text);

CREATE OR REPLACE FUNCTION public.waivers_generate_otp(
  p_business_id UUID,
  p_phone_number TEXT,
  p_email TEXT,
  p_customer_id UUID DEFAULT NULL,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_otp_code TEXT;
  v_customer_id UUID;
  v_final_email TEXT;
BEGIN
  p_phone_number := regexp_replace(p_phone_number, '[^0-9]', '', 'g');
  v_otp_code := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');

  IF trim(coalesce(p_email, '')) <> '' THEN
    v_final_email := trim(p_email);
    v_customer_id := NULL;
    SELECT pl.id INTO v_customer_id
    FROM pos_loyalty_accounts pl
    WHERE pl.business_id = p_business_id
      AND pl.is_active = true
      AND regexp_replace(coalesce(pl.customer_phone, ''), '[^0-9]', '', 'g') = p_phone_number
      AND lower(trim(coalesce(pl.customer_email, ''))) = lower(v_final_email)
    LIMIT 1;
  ELSIF p_customer_id IS NOT NULL THEN
    v_customer_id := p_customer_id;
    SELECT trim(customer_email) INTO v_final_email
    FROM pos_loyalty_accounts
    WHERE id = v_customer_id;
    IF v_final_email IS NULL OR v_final_email = '' THEN
      RAISE EXCEPTION 'Customer account exists but has no email address. Email is required for OTP delivery.';
    END IF;
  ELSE
    SELECT pl.id, trim(pl.customer_email) INTO v_customer_id, v_final_email
    FROM pos_loyalty_accounts pl
    WHERE pl.business_id = p_business_id
      AND pl.is_active = true
      AND regexp_replace(coalesce(pl.customer_phone, ''), '[^0-9]', '', 'g') = p_phone_number
    LIMIT 1;

    IF v_final_email IS NULL OR v_final_email = '' THEN
      RAISE EXCEPTION 'Email is required for OTP delivery. Please provide an email address.';
    END IF;
  END IF;

  INSERT INTO waiver_otp (
    business_id,
    customer_id,
    phone_number,
    email,
    otp_code,
    expires_at,
    ip_address,
    user_agent
  ) VALUES (
    p_business_id,
    v_customer_id,
    p_phone_number,
    v_final_email,
    v_otp_code,
    NOW() + INTERVAL '10 minutes',
    p_ip_address,
    p_user_agent
  );

  RETURN v_otp_code;
END;
$$;

COMMENT ON FUNCTION public.waivers_generate_otp(UUID, TEXT, TEXT, UUID, TEXT, TEXT) IS
  'Waiver OTP: non-empty p_email is never overwritten. customer_id set only if loyalty row matches phone+email.';
