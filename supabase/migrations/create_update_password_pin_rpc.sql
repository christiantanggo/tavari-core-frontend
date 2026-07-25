-- RPC function to update password and PIN in users table
-- Called by edge function after updating auth password
-- Uses SECURITY DEFINER to bypass RLS
-- Finds user by email (since auth.users.id may differ from public.users.id)

-- Drop old version with UUID parameter
DROP FUNCTION IF EXISTS update_user_password_and_pin(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION update_user_password_and_pin(
  p_user_email TEXT,
  p_hashed_password TEXT,
  p_hashed_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update users table by email (since IDs may not match between auth.users and public.users)
  UPDATE public.users
  SET 
    hashed_password = p_hashed_password,
    pin = p_hashed_pin,
    updated_at = NOW()
  WHERE email = LOWER(TRIM(p_user_email));

  -- Check if update succeeded
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not found in public.users table'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Password and PIN updated successfully'
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION update_user_password_and_pin(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION update_user_password_and_pin(TEXT, TEXT, TEXT) TO authenticated;

-- Add comment
COMMENT ON FUNCTION update_user_password_and_pin IS 'Updates hashed_password and pin in users table. Called by edge function.';

NOTIFY pgrst, 'reload schema';

