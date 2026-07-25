-- Create RPC function to get ALL staff PINs for unlock, bypassing RLS
-- This function allows ANY employee to unlock the system, regardless of who logged in
-- Uses SECURITY DEFINER to bypass RLS policies

CREATE OR REPLACE FUNCTION get_all_staff_pins_for_unlock(
  p_business_id UUID
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  first_name TEXT,
  last_name TEXT,
  pin TEXT,
  role TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Return ALL staff member information including PINs for PIN verification
  -- This bypasses RLS by using SECURITY DEFINER, allowing any employee to unlock
  -- regardless of who initially logged in with email/password
  RETURN QUERY
  SELECT 
    u.id,
    u.email,
    u.full_name,
    u.first_name,
    u.last_name,
    u.pin,
    COALESCE(ur.role, 'employee') as role
  FROM users u
  INNER JOIN user_roles ur ON ur.user_id = u.id
  WHERE ur.business_id = p_business_id
    AND ur.active = true
    AND u.pin IS NOT NULL
    AND u.pin != ''
  ORDER BY u.full_name, u.email;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_all_staff_pins_for_unlock(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_staff_pins_for_unlock(UUID) TO anon;

-- Add comment for documentation
COMMENT ON FUNCTION get_all_staff_pins_for_unlock(UUID) IS 
'Returns ALL staff member information including PINs for system unlock. ' ||
'Bypasses RLS using SECURITY DEFINER to allow any employee PIN to unlock the system, ' ||
'regardless of who logged in with email/password. ' ||
'This is essential for shared computer scenarios where multiple employees use the same computer.';





