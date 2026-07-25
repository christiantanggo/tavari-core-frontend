-- Step 22: Create function appbuilder_initialize_business_modules
-- Function to initialize existing business_module_usage table for new business with default enabled modules

CREATE OR REPLACE FUNCTION appbuilder_initialize_business_modules(business_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO business_module_usage (
        business_id, 
        module_key, 
        module_name, 
        enabled, 
        usage_count, 
        last_used,
        created_at,
        updated_at
    )
    SELECT 
        business_uuid, 
        am.module_key, 
        am.module_name, 
        am.enabled_by_default, 
        0, 
        now(),
        now(),
        now()
    FROM app_modules am
    WHERE am.enabled_by_default = true
        AND NOT EXISTS (
            SELECT 1 
            FROM business_module_usage bmu
            WHERE bmu.business_id = business_uuid
                AND bmu.module_key = am.module_key
        );
END;
$$;




