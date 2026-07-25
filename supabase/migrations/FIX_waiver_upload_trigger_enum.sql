-- Quick fix: Update waiver upload trigger to use valid enum value
-- This fixes the "invalid input value for enum audit_event_type" error

-- Drop the existing trigger
DROP TRIGGER IF EXISTS trigger_waiver_uploads_audit_log ON waiver_uploads;

-- Recreate the trigger function to use 'waiver.uploaded' enum value
-- (now that it's been added to the audit_event_type enum)
CREATE OR REPLACE FUNCTION log_waiver_upload_audit_event()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Use 'waiver.uploaded' enum value (now available in audit_event_type)
    INSERT INTO audit_logs (
      user_id,
      business_id,
      event_type,
      details,
      timestamp
    ) VALUES (
      COALESCE(NEW.uploaded_by, auth.uid()),
      NEW.business_id,
      'waiver.uploaded'::audit_event_type,
      jsonb_build_object(
        'upload_id', NEW.id,
        'upload_type', NEW.upload_type,
        'participant_name', NEW.first_name || ' ' || NEW.last_name,
        'customer_id', NEW.customer_id,
        'linked_waiver_id', NEW.linked_waiver_id,
        'waiver_filled_date', NEW.waiver_filled_date,
        'date_of_birth', NEW.date_of_birth,
        'file_path', NEW.file_path,
        'file_size', NEW.file_size,
        'mime_type', NEW.mime_type,
        'source', 'waiver_uploads_trigger'
      ),
      COALESCE(NEW.uploaded_at, NOW())
    );
  END IF;
  
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- If audit logging fails, don't prevent the upload from succeeding
    RAISE WARNING 'Failed to log waiver upload audit event: %', SQLERRM;
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

-- Verify trigger was created
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_timing
FROM information_schema.triggers
WHERE trigger_name = 'trigger_waiver_uploads_audit_log';

