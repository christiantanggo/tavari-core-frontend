-- Step 12: Create function appbuilder_get_enabled_modules
-- Function to get enabled modules for a business with usage stats

CREATE OR REPLACE FUNCTION appbuilder_get_enabled_modules(business_uuid uuid)
RETURNS TABLE (
    module_key text,
    module_name text,
    enabled boolean,
    usage_count integer,
    last_used timestamp without time zone,
    trial_enabled boolean,
    trial_expires_at timestamptz,
    catalog_name text,
    description text,
    icon text,
    module_category text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        CAST(bmu.module_key AS text),
        CAST(COALESCE(bmu.module_name, am.module_name) AS text),
        bmu.enabled,
        bmu.usage_count,
        bmu.last_used,
        bmu.trial_enabled,
        bmu.trial_expires_at,
        CAST(am.module_name AS text) as catalog_name,
        CAST(am.description AS text),
        CAST(am.icon AS text),
        CAST(am.module_category AS text)
    FROM business_module_usage bmu
    JOIN app_modules am ON bmu.module_key = am.module_key
    WHERE bmu.business_id = business_uuid 
        AND bmu.enabled = true
    ORDER BY am.module_category, am.module_name;
END;
$$;

