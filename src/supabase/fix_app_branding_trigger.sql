-- FIX FOR APP_BRANDING TRIGGER - Run this in Supabase SQL Editor
-- This will check the enum values and fix the trigger accordingly

-- Step 1: Check what enum values exist (run this first to see what's available)
SELECT 
    t.typname AS enum_name,
    e.enumlabel AS enum_value
FROM pg_type t 
JOIN pg_enum e ON t.oid = e.enumtypid  
WHERE t.typname = 'audit_event_type'
ORDER BY e.enumsortorder;

-- Step 2: Temporarily disable the trigger to allow updates to work
DROP TRIGGER IF EXISTS app_branding_audit_log ON app_branding;

-- Step 3: Recreate the trigger function with proper enum casting
-- Using the first valid enum value we find (or 'login' as a safe default)
CREATE OR REPLACE FUNCTION log_app_branding_changes()
RETURNS TRIGGER AS $$
DECLARE
    event_type_text text;
    event_type_enum audit_event_type;
    first_enum_value text;
BEGIN
    -- Get the first available enum value as a fallback
    SELECT enumlabel INTO first_enum_value
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'audit_event_type'
    ORDER BY e.enumsortorder
    LIMIT 1;
    
    -- Determine the event type text
    event_type_text := CASE 
        WHEN TG_OP = 'INSERT' THEN 'app_branding.created'
        WHEN TG_OP = 'UPDATE' THEN 'app_branding.updated'
        WHEN TG_OP = 'DELETE' THEN 'app_branding.deleted'
    END;
    
    -- Try to use 'user_profile_access', fallback to first enum value
    BEGIN
        event_type_enum := 'user_profile_access'::audit_event_type;
    EXCEPTION WHEN OTHERS THEN
        -- If 'user_profile_access' doesn't exist, use the first enum value
        event_type_enum := first_enum_value::audit_event_type;
    END;
    
    INSERT INTO audit_logs (
        user_id,
        business_id,
        event_type,
        details,
        timestamp
    )
    VALUES (
        auth.uid(),
        COALESCE(NEW.business_id, OLD.business_id),
        event_type_enum,
        jsonb_build_object(
            'original_event_type', event_type_text,
            'table', 'app_branding',
            'id', COALESCE(NEW.id, OLD.id),
            'operation', TG_OP,
            'changes', CASE 
                WHEN TG_OP = 'UPDATE' THEN jsonb_build_object(
                    'app_name', jsonb_build_object('old', OLD.app_name, 'new', NEW.app_name),
                    'primary_color', jsonb_build_object('old', OLD.primary_color, 'new', NEW.primary_color)
                )
                ELSE NULL
            END
        ),
        now()
    );
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Step 4: Recreate the trigger
CREATE TRIGGER app_branding_audit_log
    AFTER INSERT OR UPDATE OR DELETE ON app_branding
    FOR EACH ROW
    EXECUTE FUNCTION log_app_branding_changes();

-- Step 5: Fix the business_module_usage trigger too
DROP TRIGGER IF EXISTS business_module_usage_audit_log ON business_module_usage;

CREATE OR REPLACE FUNCTION log_business_module_usage_changes()
RETURNS TRIGGER AS $$
DECLARE
    event_type_text text;
    event_type_enum audit_event_type;
    first_enum_value text;
BEGIN
    -- Get the first available enum value as a fallback
    SELECT enumlabel INTO first_enum_value
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'audit_event_type'
    ORDER BY e.enumsortorder
    LIMIT 1;
    
    -- Only log when enabled status changes
    IF TG_OP = 'UPDATE' AND OLD.enabled IS DISTINCT FROM NEW.enabled THEN
        -- Determine the event type text
        event_type_text := CASE 
            WHEN NEW.enabled = true THEN 'module.enabled'
            WHEN NEW.enabled = false THEN 'module.disabled'
        END;
        
        -- Try to use 'user_profile_access', fallback to first enum value
        BEGIN
            event_type_enum := 'user_profile_access'::audit_event_type;
        EXCEPTION WHEN OTHERS THEN
            -- If 'user_profile_access' doesn't exist, use the first enum value
            event_type_enum := first_enum_value::audit_event_type;
        END;
        
        INSERT INTO audit_logs (
            user_id,
            business_id,
            event_type,
            details,
            timestamp
        )
        VALUES (
            auth.uid(),
            NEW.business_id,
            event_type_enum,
            jsonb_build_object(
                'original_event_type', event_type_text,
                'table', 'business_module_usage',
                'module_key', NEW.module_key,
                'module_name', NEW.module_name,
                'enabled', NEW.enabled,
                'operation', 'update'
            ),
            now()
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER business_module_usage_audit_log
    AFTER UPDATE ON business_module_usage
    FOR EACH ROW
    WHEN (OLD.enabled IS DISTINCT FROM NEW.enabled)
    EXECUTE FUNCTION log_business_module_usage_changes();




