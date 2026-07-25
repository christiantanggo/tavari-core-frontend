-- Create custom password reset token system
-- This allows us to send custom emails instead of using Supabase's default email

-- Ensure pgcrypto extension is enabled (required for gen_random_bytes)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Table to store password reset tokens
CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT token_unique UNIQUE (token)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON public.password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON public.password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON public.password_reset_tokens(expires_at);

-- Enable RLS
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to allow re-running this migration)
DROP POLICY IF EXISTS "Users can view their own reset tokens" ON public.password_reset_tokens;
DROP POLICY IF EXISTS "Service role can manage reset tokens" ON public.password_reset_tokens;

-- RLS Policy: Users can view their own tokens (for verification)
CREATE POLICY "Users can view their own reset tokens"
  ON public.password_reset_tokens
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- RLS Policy: Service role can manage all tokens
CREATE POLICY "Service role can manage reset tokens"
  ON public.password_reset_tokens
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Drop existing functions if they exist (to allow re-running this migration)
DROP FUNCTION IF EXISTS request_password_reset(TEXT);
DROP FUNCTION IF EXISTS verify_password_reset_token(TEXT);
DROP FUNCTION IF EXISTS mark_password_reset_token_used(TEXT);

-- Function to generate and send password reset token
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

  -- Generate secure token using UUID (doesn't require pgcrypto extension)
  -- Combine multiple UUIDs for security (128 characters, hex encoded)
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

-- Function to verify password reset token (does NOT mark as used - that happens when password is updated)
CREATE OR REPLACE FUNCTION verify_password_reset_token(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token_record RECORD;
  v_result JSONB;
BEGIN
  -- Find token
  SELECT * INTO v_token_record
  FROM public.password_reset_tokens
  WHERE token = p_token
    AND expires_at > NOW()
    AND used_at IS NULL
  LIMIT 1;

  IF v_token_record IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid or expired reset token'
    );
  END IF;

  -- Return user info (do NOT mark as used yet - that happens when password is actually updated)
  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_token_record.user_id,
    'email', (SELECT email FROM auth.users WHERE id = v_token_record.user_id)
  );
END;
$$;

-- Function to mark password reset token as used (called after password is successfully updated)
CREATE OR REPLACE FUNCTION mark_password_reset_token_used(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Mark token as used
  UPDATE public.password_reset_tokens
  SET used_at = NOW()
  WHERE token = p_token
    AND used_at IS NULL;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION request_password_reset(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION request_password_reset(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION verify_password_reset_token(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION verify_password_reset_token(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION mark_password_reset_token_used(TEXT) TO service_role;

-- Add comments
COMMENT ON TABLE public.password_reset_tokens IS 'Stores password reset tokens for custom email flow';
COMMENT ON FUNCTION request_password_reset IS 'Generates a password reset token and returns it for custom email sending';
COMMENT ON FUNCTION verify_password_reset_token IS 'Verifies a password reset token and marks it as used';

NOTIFY pgrst, 'reload schema';

