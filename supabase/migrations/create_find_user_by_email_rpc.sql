-- ============================================
-- RPC Function to Find User by Email (Bypasses RLS)
-- This is needed for the login screen since users aren't authenticated yet
-- ============================================

-- Drop existing function if it exists (needed to change return type)
DROP FUNCTION IF EXISTS find_user_by_email_for_login(TEXT);

CREATE OR REPLACE FUNCTION find_user_by_email_for_login(p_email TEXT)
RETURNS TABLE (
  id UUID,
  email TEXT,
  hashed_password TEXT,
  pin TEXT,
  employment_status TEXT,
  termination_date DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id,
    u.email,
    u.hashed_password,
    u.pin,
    u.employment_status,
    u.termination_date
  FROM users u
  WHERE LOWER(TRIM(u.email)) = LOWER(TRIM(p_email))
  LIMIT 1;
END;
$$;

-- Grant execute permission to authenticated and anon users
GRANT EXECUTE ON FUNCTION find_user_by_email_for_login(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION find_user_by_email_for_login(TEXT) TO anon;

COMMENT ON FUNCTION find_user_by_email_for_login(TEXT) IS 'Finds a user by email for login purposes. Bypasses RLS since users are not authenticated yet.';

