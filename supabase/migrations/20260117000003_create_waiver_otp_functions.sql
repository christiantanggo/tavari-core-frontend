-- Functions for waiver OTP authentication system

-- Function: Generate and store OTP for waiver signing
CREATE OR REPLACE FUNCTION waivers_generate_otp(
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
AS $$
DECLARE
  v_otp_code TEXT;
  v_customer_id UUID;
BEGIN
  -- Normalize phone number (remove non-digits)
  p_phone_number := regexp_replace(p_phone_number, '[^0-9]', '', 'g');
  
  -- Generate 6-digit OTP
  v_otp_code := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
  
  -- If customer_id not provided, try to find existing customer
  IF p_customer_id IS NULL THEN
    SELECT id INTO v_customer_id
    FROM pos_loyalty_accounts
    WHERE business_id = p_business_id
      AND customer_phone = p_phone_number
      AND is_active = true
    LIMIT 1;
  ELSE
    v_customer_id := p_customer_id;
  END IF;
  
  -- If customer exists, use the email on file (required)
  IF v_customer_id IS NOT NULL THEN
    SELECT customer_email INTO p_email
    FROM pos_loyalty_accounts
    WHERE id = v_customer_id;
    
    -- If customer exists but no email on file, raise error
    IF p_email IS NULL OR p_email = '' THEN
      RAISE EXCEPTION 'Customer account exists but has no email address. Email is required for OTP delivery.';
    END IF;
  ELSE
    -- If no customer found, email must be provided as parameter
    IF p_email IS NULL OR p_email = '' THEN
      RAISE EXCEPTION 'Email is required for OTP delivery. Please provide an email address.';
    END IF;
  END IF;
  
  -- Insert OTP record
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

-- Function: Verify OTP code
CREATE OR REPLACE FUNCTION waivers_verify_otp(
  p_phone_number TEXT,
  p_otp_code TEXT,
  p_business_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_otp_record RECORD;
  v_customer_id UUID;
  v_customer_email TEXT;
  v_result JSONB;
BEGIN
  -- Normalize phone number
  p_phone_number := regexp_replace(p_phone_number, '[^0-9]', '', 'g');
  
  -- Find valid OTP
  SELECT * INTO v_otp_record
  FROM waiver_otp
  WHERE phone_number = p_phone_number
    AND otp_code = p_otp_code
    AND business_id = p_business_id
    AND is_used = false
    AND expires_at > NOW()
    AND attempts < max_attempts
  ORDER BY created_at DESC
  LIMIT 1;
  
  -- If not found, increment attempts on most recent attempt
  IF v_otp_record IS NULL THEN
    UPDATE waiver_otp
    SET attempts = attempts + 1
    WHERE id = (
      SELECT id
      FROM waiver_otp
      WHERE phone_number = p_phone_number
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
  
  -- Mark OTP as used
  UPDATE waiver_otp
  SET is_used = true,
      verified_at = NOW()
  WHERE id = v_otp_record.id;
  
  -- Get customer info if exists
  IF v_otp_record.customer_id IS NOT NULL THEN
    SELECT id, customer_email INTO v_customer_id, v_customer_email
    FROM pos_loyalty_accounts
    WHERE id = v_otp_record.customer_id;
  END IF;
  
  -- Return success with customer info
  RETURN jsonb_build_object(
    'valid', true,
    'customer_id', v_customer_id,
    'email', COALESCE(v_customer_email, v_otp_record.email),
    'phone_number', v_otp_record.phone_number
  );
END;
$$;

-- Add comments
COMMENT ON FUNCTION waivers_generate_otp IS 'Generate OTP code for waiver signing. Sends OTP to customer email on file. Expires in 10 minutes.';
COMMENT ON FUNCTION waivers_verify_otp IS 'Verify OTP code for waiver signing. Returns customer info if valid.';


