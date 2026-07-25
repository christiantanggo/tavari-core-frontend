-- Step 29: Create helper function appbuilder_get_user_business_ids
-- Function to get all businesses user has access to via user_roles table (existing)

CREATE OR REPLACE FUNCTION appbuilder_get_user_business_ids(user_uuid uuid)
RETURNS TABLE (business_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT ur.business_id
    FROM user_roles ur
    WHERE ur.user_id = user_uuid
        AND ur.active = true;
END;
$$;




