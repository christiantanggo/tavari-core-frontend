-- Step 26: Create audit log trigger for app changes
-- Trigger to log app_branding and business_module_usage changes to existing audit_logs table

-- Trigger for app_branding changes
CREATE OR REPLACE FUNCTION log_app_branding_changes()
RETURNS TRIGGER AS $$
DECLARE
    event_type_text text;
    event_type_enum audit_event_type;
BEGIN
    -- Determine the event type text
    event_type_text := CASE 
        WHEN TG_OP = 'INSERT' THEN 'app_branding.created'
        WHEN TG_OP = 'UPDATE' THEN 'app_branding.updated'
        WHEN TG_OP = 'DELETE' THEN 'app_branding.deleted'
    END;
    
    -- Map to a valid enum value (using user_profile_access as default for custom events)
    -- Store the original event type in details
    event_type_enum := 'user_profile_access'::audit_event_type;
    
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

DROP TRIGGER IF EXISTS app_branding_audit_log ON app_branding;
CREATE TRIGGER app_branding_audit_log
    AFTER INSERT OR UPDATE OR DELETE ON app_branding
    FOR EACH ROW
    EXECUTE FUNCTION log_app_branding_changes();

-- Trigger for business_module_usage changes (enabled/disabled)
CREATE OR REPLACE FUNCTION log_business_module_usage_changes()
RETURNS TRIGGER AS $$
DECLARE
    event_type_text text;
    event_type_enum audit_event_type;
BEGIN
    -- Only log when enabled status changes
    IF TG_OP = 'UPDATE' AND OLD.enabled IS DISTINCT FROM NEW.enabled THEN
        -- Determine the event type text
        event_type_text := CASE 
            WHEN NEW.enabled = true THEN 'module.enabled'
            WHEN NEW.enabled = false THEN 'module.disabled'
        END;
        
        -- Map to a valid enum value (using user_profile_access as default for custom events)
        -- Store the original event type in details
        event_type_enum := 'user_profile_access'::audit_event_type;
        
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

DROP TRIGGER IF EXISTS business_module_usage_audit_log ON business_module_usage;
CREATE TRIGGER business_module_usage_audit_log
    AFTER UPDATE ON business_module_usage
    FOR EACH ROW
    WHEN (OLD.enabled IS DISTINCT FROM NEW.enabled)
    EXECUTE FUNCTION log_business_module_usage_changes();

