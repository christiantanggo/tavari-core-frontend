-- Step 13: Create function appbuilder_check_module_access
-- Function to check if user's business has module enabled and user has access

CREATE OR REPLACE FUNCTION appbuilder_check_module_access(
    business_uuid uuid,
    module_key text,
    user_uuid uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM business_module_usage bmu
        JOIN user_roles ur ON bmu.business_id = ur.business_id
        WHERE bmu.business_id = business_uuid
            AND bmu.module_key = module_key
            AND bmu.enabled = true
            AND ur.user_id = user_uuid
            AND ur.active = true
    );
END;
$$;




