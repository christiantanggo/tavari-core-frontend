-- Fix for appbuilder_update_module_usage function
-- Resolves "column reference 'module_key' is ambiguous" error
-- This version uses local variables and proper table qualification to avoid ambiguity

DROP FUNCTION IF EXISTS appbuilder_update_module_usage(uuid, text, integer);

CREATE OR REPLACE FUNCTION appbuilder_update_module_usage(
    business_uuid uuid,
    p_module_key text, -- Renamed parameter to avoid conflict
    increment_count integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_module_name text;
    v_module_key text;
BEGIN
    -- Store parameter in local variable
    v_module_key := p_module_key;
    
    -- Get module name from app_modules catalog (if exists)
    SELECT am.module_name INTO v_module_name
    FROM app_modules am
    WHERE am.module_key = v_module_key
    LIMIT 1;
    
    -- Default to module_key if not found in catalog
    v_module_name := COALESCE(v_module_name, v_module_key);
    
    -- Attempt to insert or update the record
    -- Use local variable v_module_key everywhere to avoid ambiguity
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
        business_uuid,
        v_module_key, -- Use local variable
        v_module_name,
        false,
        increment_count,
        now(),
        now(),
        now()
    )
    ON CONFLICT (business_id, module_key) DO UPDATE SET
        usage_count = COALESCE(business_module_usage.usage_count, 0) + increment_count,
        last_used = now(),
        updated_at = now(),
        module_name = EXCLUDED.module_name;
END;
$$;



