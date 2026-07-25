-- Step 27: Create function appbuilder_get_module_permissions
-- Function to get role_permissions mapped to module
-- Uses existing role_permissions and permission_definitions tables

CREATE OR REPLACE FUNCTION appbuilder_get_module_permissions(
    business_uuid uuid,
    module_key text
)
RETURNS TABLE (
    role text,
    permission_key text,
    permission_name text,
    granted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        rp.role,
        pd.permission_key,
        pd.permission_name,
        rp.granted
    FROM role_permissions rp
    JOIN permission_definitions pd ON rp.permission_id = pd.id
    WHERE rp.business_id = business_uuid
        AND pd.module_key = module_key
        AND rp.active = true;
END;
$$;




