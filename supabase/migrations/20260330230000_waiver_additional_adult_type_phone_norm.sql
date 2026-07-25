-- Normalize participant_type matching (e.g. "additional adult" vs additional_adult) and NANP phone
-- (strip leading 1) so additional-adult lookup and OTP loyalty phone match the app.

CREATE OR REPLACE FUNCTION public.waiver_otp_phone_digits(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN length(d) < 1 THEN ''
    WHEN length(d) = 11 AND left(d, 1) = '1' THEN substring(d from 2)
    ELSE d
  END
  FROM (SELECT regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') AS d) s;
$$;

COMMENT ON FUNCTION public.waiver_otp_phone_digits(text) IS
  'Digits only; strip leading US/CA country code 1 when 11 digits (waiver OTP / participant phone matching).';

CREATE OR REPLACE FUNCTION public.waivers_find_ids_by_additional_adult_phone(
  p_business_id uuid,
  p_normalized_phone text
)
RETURNS TABLE (waiver_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH want AS (
    SELECT public.waiver_otp_phone_digits(p_normalized_phone) AS d
  )
  SELECT DISTINCT wp.waiver_id
  FROM waiver_participants wp
  INNER JOIN waiver_signatures ws ON ws.id = wp.waiver_id
  CROSS JOIN want
  WHERE ws.business_id = p_business_id
    AND regexp_replace(lower(trim(coalesce(wp.participant_type, ''))), '\s+', '_', 'g') IN ('additional_adult', 'additionaladult')
    AND length(want.d) >= 10
    AND public.waiver_otp_phone_digits(wp.phone_number) = want.d;
$$;

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
  v_phone TEXT;
BEGIN
  v_phone := public.waiver_otp_phone_digits(p_phone_number);
  v_otp_code := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');

  IF trim(coalesce(p_email, '')) <> '' THEN
    v_final_email := trim(p_email);
    v_customer_id := NULL;
    SELECT pl.id INTO v_customer_id
    FROM pos_loyalty_accounts pl
    WHERE pl.business_id = p_business_id
      AND pl.is_active = true
      AND public.waiver_otp_phone_digits(pl.customer_phone) = v_phone
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
      AND public.waiver_otp_phone_digits(pl.customer_phone) = v_phone
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
    v_phone,
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
  'Waiver OTP: non-empty p_email is never overwritten. Phone digits normalized (strip leading 1). customer_id only if phone+email match.';

CREATE OR REPLACE FUNCTION public.waivers_verify_otp(
  p_phone_number TEXT,
  p_otp_code TEXT,
  p_business_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_otp_record RECORD;
  v_customer_id UUID;
  v_customer_email TEXT;
BEGIN
  p_phone_number := public.waiver_otp_phone_digits(p_phone_number);

  SELECT * INTO v_otp_record
  FROM waiver_otp
  WHERE public.waiver_otp_phone_digits(phone_number) = p_phone_number
    AND otp_code = p_otp_code
    AND business_id = p_business_id
    AND is_used = false
    AND expires_at > NOW()
    AND attempts < max_attempts
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_otp_record IS NULL THEN
    UPDATE waiver_otp
    SET attempts = attempts + 1
    WHERE id = (
      SELECT id
      FROM waiver_otp
      WHERE public.waiver_otp_phone_digits(phone_number) = p_phone_number
        AND business_id = p_business_id
        AND is_used = false
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    );

    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Invalid or expired OTP code'
    );
  END IF;

  UPDATE waiver_otp
  SET is_used = true,
      verified_at = NOW()
  WHERE id = v_otp_record.id;

  IF v_otp_record.customer_id IS NOT NULL THEN
    SELECT id, customer_email INTO v_customer_id, v_customer_email
    FROM pos_loyalty_accounts
    WHERE id = v_otp_record.customer_id;
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'customer_id', v_customer_id,
    'email', COALESCE(v_customer_email, v_otp_record.email),
    'phone_number', v_otp_record.phone_number
  );
END;
$$;
