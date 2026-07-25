-- Fix waiver upload audit trigger to handle enum values correctly
-- Option 1: Add missing enum values if they don't exist
-- Option 2: Update trigger to use valid enum value

-- First, check if enum values exist and add them if needed
DO $$
BEGIN
  -- Add 'waiver.uploaded' enum value if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'audit_event_type'
    AND e.enumlabel = 'waiver.uploaded'
  ) THEN
    ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'waiver.uploaded';
    RAISE NOTICE 'Added waiver.uploaded to audit_event_type enum';
  ELSE
    RAISE NOTICE 'waiver.uploaded already exists in audit_event_type enum';
  END IF;
  
  -- Add 'waiver.created' enum value if it doesn't exist (for consistency)
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'audit_event_type'
    AND e.enumlabel = 'waiver.created'
  ) THEN
    ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'waiver.created';
    RAISE NOTICE 'Added waiver.created to audit_event_type enum';
  ELSE
    RAISE NOTICE 'waiver.created already exists in audit_event_type enum';
  END IF;
END $$;

-- Now fix the trigger function to handle enum gracefully
-- Drop the trigger first
DROP TRIGGER IF EXISTS trigger_waiver_uploads_audit_log ON waiver_uploads;

-- Recreate the trigger function with proper error handling
CREATE OR REPLACE FUNCTION log_waiver_upload_audit_event()
RETURNS TRIGGER AS $$
DECLARE
  event_type_value audit_event_type;
  fallback_enum_value text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Try to use 'waiver.uploaded', fallback to 'user_profile_access' if it doesn't exist
    BEGIN
      -- Check if 'waiver.uploaded' exists in enum
      SELECT enumlabel INTO fallback_enum_value
      FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'audit_event_type'
      AND e.enumlabel = 'waiver.uploaded'
      LIMIT 1;
      
      IF fallback_enum_value IS NOT NULL THEN
        event_type_value := 'waiver.uploaded'::audit_event_type;
      ELSE
        -- Fallback to a generic enum value that should exist
        SELECT enumlabel INTO fallback_enum_value
        FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'audit_event_type'
        ORDER BY e.enumsortorder
        LIMIT 1;
        
        IF fallback_enum_value IS NOT NULL THEN
          event_type_value := fallback_enum_value::audit_event_type;
        ELSE
          -- If no enum values exist at all, skip logging (shouldn't happen)
          RAISE WARNING 'No audit_event_type enum values found, skipping audit log';
          RETURN NEW;
        END IF;
      END IF;
      
      INSERT INTO audit_logs (
        user_id,
        business_id,
        event_type,
        details,
        timestamp
      ) VALUES (
        COALESCE(NEW.uploaded_by, auth.uid()),
        NEW.business_id,
        event_type_value,
        jsonb_build_object(
          'upload_id', NEW.id,
          'upload_type', NEW.upload_type,
          'file_name', NEW.first_name || ' ' || NEW.last_name,
          'customer_id', NEW.customer_id,
          'linked_waiver_id', NEW.linked_waiver_id,
          'original_event_type', 'waiver.uploaded'
        ),
        COALESCE(NEW.uploaded_at, NOW())
      );
    EXCEPTION
      WHEN invalid_text_representation THEN
        -- Enum value doesn't exist, use fallback
        RAISE WARNING 'waiver.uploaded enum value not found, using fallback';
        INSERT INTO audit_logs (
          user_id,
          business_id,
          event_type,
          details,
          timestamp
        ) VALUES (
          COALESCE(NEW.uploaded_by, auth.uid()),
          NEW.business_id,
          'user_profile_access'::audit_event_type,
          jsonb_build_object(
            'upload_id', NEW.id,
            'upload_type', NEW.upload_type,
            'file_name', NEW.first_name || ' ' || NEW.last_name,
            'customer_id', NEW.customer_id,
            'linked_waiver_id', NEW.linked_waiver_id,
            'original_event_type', 'waiver.uploaded',
            'note', 'Enum value waiver.uploaded not found, used fallback'
          ),
          COALESCE(NEW.uploaded_at, NOW())
        );
    END;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate the trigger
CREATE TRIGGER trigger_waiver_uploads_audit_log
    AFTER INSERT ON waiver_uploads
    FOR EACH ROW
    EXECUTE FUNCTION log_waiver_upload_audit_event();

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

-- Verify the enum values exist
SELECT 
    t.typname AS enum_name,
    e.enumlabel AS enum_value
FROM pg_type t 
JOIN pg_enum e ON t.oid = e.enumtypid  
WHERE t.typname = 'audit_event_type'
AND e.enumlabel IN ('waiver.uploaded', 'waiver.created')
ORDER BY e.enumsortorder;





