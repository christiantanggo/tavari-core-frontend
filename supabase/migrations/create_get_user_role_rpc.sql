-- ============================================
-- RPC Function to Get user_roles by user_id (Bypasses RLS)
-- ============================================

CREATE OR REPLACE FUNCTION get_user_role_by_user_id(p_user_id UUID)
RETURNS TABLE (
  user_id UUID,
  business_id UUID,
  role TEXT,
  active BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ur.user_id,
    ur.business_id,
    ur.role,
    ur.active
  FROM user_roles ur
  WHERE ur.user_id = p_user_id
    AND ur.active = true
  LIMIT 1;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_user_role_by_user_id(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_role_by_user_id(UUID) TO anon;

COMMENT ON FUNCTION get_user_role_by_user_id(UUID) IS 'Gets user_roles entry by user_id (bypasses RLS).';








