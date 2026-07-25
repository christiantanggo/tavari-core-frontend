-- Fix password reset functions - use UUID instead of gen_random_bytes
-- This doesn't require pgcrypto extension

-- Recreate the function to use UUID for token generation
DROP FUNCTION IF EXISTS request_password_reset(TEXT);

CREATE OR REPLACE FUNCTION request_password_reset(p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_token TEXT;
  v_expires_at TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  -- Find user by email
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = LOWER(TRIM(p_email))
  LIMIT 1;

  -- Don't reveal if user exists (security best practice)
  IF v_user_id IS NULL THEN
    -- Return success even if user doesn't exist to prevent email enumeration
    RETURN jsonb_build_object(
      'success', true,
      'message', 'If an account exists with this email, a password reset link has been sent'
    );
  END IF;

  -- Generate secure token using UUID and random (doesn't require pgcrypto)
  -- Combine multiple UUIDs and random values for security
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  
  -- Set expiration (1 hour from now)
  v_expires_at := NOW() + INTERVAL '1 hour';

  -- Delete old unused tokens for this user
  DELETE FROM public.password_reset_tokens
  WHERE user_id = v_user_id
    AND (used_at IS NULL OR expires_at < NOW());

  -- Insert new token
  INSERT INTO public.password_reset_tokens (user_id, token, expires_at)
  VALUES (v_user_id, v_token, v_expires_at);

  -- Return token and user info (frontend will call mail-send edge function)
  RETURN jsonb_build_object(
    'success', true,
    'token', v_token,
    'user_id', v_user_id,
    'email', p_email,
    'expires_at', v_expires_at,
    'message', 'If an account exists with this email, a password reset link has been sent'
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION request_password_reset(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION request_password_reset(TEXT) TO anon;

-- Reload PostgREST schema
NOTIFY pgrst, 'reload schema';

-- Verify function exists
SELECT 
  proname,
  pg_get_function_arguments(oid) as arguments
FROM pg_proc
WHERE proname = 'request_password_reset';

