-- Step 28: Create helper function appbuilder_check_business_access
-- Function to check if user has access to business via user_roles table (existing)

CREATE OR REPLACE FUNCTION appbuilder_check_business_access(
    business_uuid uuid,
    user_uuid uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM user_roles
        WHERE user_id = user_uuid
            AND business_id = business_uuid
            AND active = true
    );
END;
$$;




