-- Final fix for appbuilder_update_module_usage function
-- Completely eliminates ambiguity by using table-qualified column names and local variables

DROP FUNCTION IF EXISTS appbuilder_update_module_usage(uuid, text, integer);

CREATE OR REPLACE FUNCTION appbuilder_update_module_usage(
    business_uuid uuid,
    module_key text,
    increment_count integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_module_name text;
    v_module_key text;
    v_business_id uuid;
BEGIN
    -- Store all parameters in local variables immediately
    v_module_key := module_key;
    v_business_id := business_uuid;
    
    -- Get module name from app_modules catalog (if exists)
    SELECT am.module_name INTO v_module_name
    FROM app_modules am
    WHERE am.module_key = v_module_key
    LIMIT 1;
    
    -- Default to module_key if not found in catalog
    v_module_name := COALESCE(v_module_name, v_module_key);
    
    -- Use UPDATE ... WHERE ... ELSE INSERT pattern to avoid ON CONFLICT ambiguity
    -- This approach completely avoids the ON CONFLICT clause which causes the ambiguity
    
    UPDATE business_module_usage
    SET 
        usage_count = COALESCE(usage_count, 0) + increment_count,
        last_used = now(),
        updated_at = now(),
        module_name = v_module_name
    WHERE business_id = v_business_id 
      AND business_module_usage.module_key = v_module_key;
    
    -- If no row was updated, insert a new one
    IF NOT FOUND THEN
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
        VALUES (
            v_business_id,
            v_module_key,
            v_module_name,
            false,
            increment_count,
            now(),
            now(),
            now()
        );
    END IF;
END;
$$;



