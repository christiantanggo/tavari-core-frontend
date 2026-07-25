-- When an additional adult verifies with their phone, the client passes their waiver_participants email.
-- The old waivers_generate_otp always looked up pos_loyalty_accounts by phone and overwrote p_email with
-- customer_email — sending the OTP to the wrong inbox. Skip that when p_use_provided_email_only is true.

DROP FUNCTION IF EXISTS public.waivers_generate_otp(uuid, text, text, uuid, text, text);

CREATE OR REPLACE FUNCTION public.waivers_generate_otp(
  p_business_id UUID,
  p_phone_number TEXT,
  p_email TEXT,
  p_customer_id UUID DEFAULT NULL,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_use_provided_email_only BOOLEAN DEFAULT FALSE
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_otp_code TEXT;
  v_customer_id UUID;
BEGIN
  p_phone_number := regexp_replace(p_phone_number, '[^0-9]', '', 'g');

  v_otp_code := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');

  IF COALESCE(p_use_provided_email_only, FALSE) THEN
    v_customer_id := NULL;
    IF p_email IS NULL OR trim(p_email) = '' THEN
      RAISE EXCEPTION 'Email is required for OTP delivery. Please provide an email address.';
    END IF;
    p_email := trim(p_email);
  ELSE
    IF p_customer_id IS NULL THEN
      SELECT id INTO v_customer_id
      FROM pos_loyalty_accounts
      WHERE business_id = p_business_id
        AND regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g') = p_phone_number
        AND is_active = true
      LIMIT 1;
    ELSE
      v_customer_id := p_customer_id;
    END IF;

    IF v_customer_id IS NOT NULL THEN
      SELECT trim(customer_email) INTO p_email
      FROM pos_loyalty_accounts
      WHERE id = v_customer_id;

      IF p_email IS NULL OR p_email = '' THEN
        RAISE EXCEPTION 'Customer account exists but has no email address. Email is required for OTP delivery.';
      END IF;
    ELSE
      IF p_email IS NULL OR trim(p_email) = '' THEN
        RAISE EXCEPTION 'Email is required for OTP delivery. Please provide an email address.';
      END IF;
      p_email := trim(p_email);
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
    p_email,
    v_otp_code,
    NOW() + INTERVAL '10 minutes',
    p_ip_address,
    p_user_agent
  );

  RETURN v_otp_code;
END;
$$;

COMMENT ON FUNCTION public.waivers_generate_otp(UUID, TEXT, TEXT, UUID, TEXT, TEXT, BOOLEAN) IS
  'Generate OTP for waiver flow. If p_use_provided_email_only, use p_email and do not overwrite from pos_loyalty_accounts (additional adult on waiver).';
