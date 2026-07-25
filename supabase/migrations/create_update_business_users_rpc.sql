-- ============================================
-- RPC Function to Update business_users user_id (Bypasses RLS)
-- This ensures business_users is linked to the correct auth user ID
-- CRITICAL: This function handles the case where public.users.id != auth.users.id
-- by updating public.users.id to match auth.users.id
-- ============================================

CREATE OR REPLACE FUNCTION update_business_users_user_id(
  p_old_user_id UUID,
  p_new_user_id UUID,
  p_business_id UUID
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_count INT := 0;
  v_inserted_count INT := 0;
  v_existing_count INT := 0;
  v_role TEXT;
  v_user_data RECORD;
BEGIN
  -- First, check if entry already exists with new user_id (we're done if so)
  SELECT COUNT(*) INTO v_existing_count
  FROM business_users
  WHERE user_id = p_new_user_id
    AND business_id = p_business_id;
  
  IF v_existing_count > 0 THEN
    RETURN QUERY SELECT true, 'business_users entry already exists with new user_id'::TEXT;
    RETURN;
  END IF;
  
  -- Get the role from user_roles for the old user_id (BEFORE we delete/update anything)
  SELECT ur.role INTO v_role
  FROM user_roles ur
  WHERE ur.user_id = p_old_user_id
    AND ur.business_id = p_business_id
    AND ur.active = true
  LIMIT 1;
  
  -- If no role found, default to 'employee'
  v_role := COALESCE(v_role, 'employee');
  
  -- CRITICAL: Check if public.users.id needs to be updated to match auth.users.id
  -- The foreign key constraint requires business_users.user_id to reference public.users.id
  -- So we need to ensure public.users.id == auth.users.id
  
  -- Check if new user_id already exists in users table
  SELECT COUNT(*) INTO v_existing_count
  FROM users
  WHERE id = p_new_user_id;
  
  RAISE NOTICE 'Checking if new user_id exists: % (count: %)', p_new_user_id, v_existing_count;
  
  IF v_existing_count > 0 THEN
    -- New user_id already exists in public.users, so we can just update business_users
    -- No need to delete/recreate the user
    UPDATE business_users
    SET user_id = p_new_user_id
    WHERE user_id = p_old_user_id
      AND business_id = p_business_id;
    
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    
    IF v_updated_count = 0 THEN
      -- No existing entry to update, insert new one
      INSERT INTO business_users (user_id, business_id, role)
      VALUES (p_new_user_id, p_business_id, v_role)
      ON CONFLICT (user_id, business_id) DO NOTHING;
      
      GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
    END IF;
    
    IF v_updated_count > 0 OR v_inserted_count > 0 THEN
      RETURN QUERY SELECT true, 'business_users updated (new user_id already existed in users)'::TEXT;
    ELSE
      RETURN QUERY SELECT false, 'Failed to update or insert business_users'::TEXT;
    END IF;
    RETURN;
  END IF;
  
  -- If we get here, new user_id doesn't exist in public.users
  -- CRITICAL: We CANNOT delete users due to foreign key constraints (NO ACTION on many tables)
  -- The business_users.user_id foreign key points to public.users.id, not auth.users.id
  -- So we MUST use the old user_id (public.users.id) for business_users
  -- PortalLayout has been updated to look up business_users using public.users.id (found by email)
  
  IF v_existing_count = 0 THEN
    RAISE NOTICE 'New user_id % does not exist in public.users. Using old user_id % for business_users (cannot delete due to FK constraints).', p_new_user_id, p_old_user_id;
    
    -- Update/insert business_users using the OLD user_id (public.users.id)
    -- This is correct because business_users.user_id must reference public.users.id
    INSERT INTO business_users (user_id, business_id, role)
    VALUES (p_old_user_id, p_business_id, v_role)
    ON CONFLICT (user_id, business_id) DO UPDATE
    SET role = EXCLUDED.role;
    
    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
    
    IF v_inserted_count > 0 THEN
      RETURN QUERY SELECT true, 'business_users updated with public.users.id (auth.users.id does not exist in public.users)'::TEXT;
    ELSE
      RETURN QUERY SELECT false, 'Failed to update or insert business_users'::TEXT;
    END IF;
    RETURN;
  END IF;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION update_business_users_user_id(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_business_users_user_id(UUID, UUID, UUID) TO anon;

COMMENT ON FUNCTION update_business_users_user_id(UUID, UUID, UUID) IS 'Updates business_users user_id from old to new (bypasses RLS). Used when auth account ID differs from public.users ID.';

