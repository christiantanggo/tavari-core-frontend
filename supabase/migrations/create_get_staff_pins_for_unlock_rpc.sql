-- Create or replace RPC function for getting staff PINs for register unlock
-- This function allows the register unlock to check ALL employees' PINs, not just the logged-in user
-- This is critical for admission counter scenarios where multiple employees use the same computer

CREATE OR REPLACE FUNCTION get_staff_pins_for_unlock(
  p_business_id UUID,
  business_user_ids UUID[]
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  first_name TEXT,
  last_name TEXT,
  pin TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Return staff member information including PINs for PIN verification
  -- Only returns users who have a PIN set
  RETURN QUERY
  SELECT 
    u.id,
    u.email,
    u.full_name,
    u.first_name,
    u.last_name,
    u.pin
  FROM users u
  WHERE u.id = ANY(business_user_ids)
    AND u.pin IS NOT NULL
    AND u.pin != ''
  ORDER BY u.full_name, u.email;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_staff_pins_for_unlock(UUID, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_staff_pins_for_unlock(UUID, UUID[]) TO anon;

-- Add comment for documentation
COMMENT ON FUNCTION get_staff_pins_for_unlock(UUID, UUID[]) IS 
'Returns staff member information including PINs for register unlock. ' ||
'Allows any employee PIN to unlock the register screen, not just the logged-in user. ' ||
'This is essential for admission counter scenarios where multiple employees use the same computer.';





