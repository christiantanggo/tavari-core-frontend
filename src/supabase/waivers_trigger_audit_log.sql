-- Step 20: Create trigger waivers_audit_log
-- Purpose: Log waiver changes to existing audit_logs table
-- Uses existing audit_logs table structure

-- Create trigger function for waiver_signatures
CREATE OR REPLACE FUNCTION log_waiver_audit_event()
RETURNS TRIGGER AS $$
BEGIN
  -- Log waiver creation
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (
      user_id,
      business_id,
      event_type,
      details,
      timestamp
    ) VALUES (
      COALESCE(NEW.created_by, auth.uid()),
      NEW.business_id,
      'waiver.created',
      jsonb_build_object(
        'waiver_id', NEW.id,
        'template_id', NEW.template_id,
        'signer_name', NEW.first_name || ' ' || NEW.last_name,
        'signature_token', NEW.signature_token,
        'is_minor', NEW.is_minor
      ),
      COALESCE(NEW.signed_at, NOW())
    );
  END IF;
  
  -- Log waiver updates (signing, expiry, etc.)
  IF TG_OP = 'UPDATE' THEN
    -- Log signing event
    IF OLD.signature_image_url IS NULL AND NEW.signature_image_url IS NOT NULL THEN
      INSERT INTO audit_logs (
        user_id,
        business_id,
        event_type,
        details,
        timestamp
      ) VALUES (
        COALESCE(NEW.created_by, auth.uid()),
        NEW.business_id,
        'waiver.signed',
        jsonb_build_object(
          'waiver_id', NEW.id,
          'signer_name', NEW.first_name || ' ' || NEW.last_name,
          'signed_at', NEW.signed_at
        ),
        NEW.signed_at
      );
    END IF;
    
    -- Log expiry event
    IF OLD.is_valid = true AND NEW.is_valid = false THEN
      INSERT INTO audit_logs (
        user_id,
        business_id,
        event_type,
        details,
        timestamp
      ) VALUES (
        COALESCE(NEW.created_by, auth.uid()),
        NEW.business_id,
        'waiver.expired',
        jsonb_build_object(
          'waiver_id', NEW.id,
          'signer_name', NEW.first_name || ' ' || NEW.last_name,
          'expires_at', NEW.expires_at
        ),
        NOW()
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on waiver_signatures
CREATE TRIGGER trigger_waiver_signatures_audit_log
    AFTER INSERT OR UPDATE ON waiver_signatures
    FOR EACH ROW
    EXECUTE FUNCTION log_waiver_audit_event();

-- Create trigger function for waiver_uploads
CREATE OR REPLACE FUNCTION log_waiver_upload_audit_event()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (
      user_id,
      business_id,
      event_type,
      details,
      timestamp
    ) VALUES (
      COALESCE(NEW.uploaded_by, auth.uid()),
      NEW.business_id,
      'waiver.uploaded',
      jsonb_build_object(
        'upload_id', NEW.id,
        'upload_type', NEW.upload_type,
        'file_name', NEW.first_name || ' ' || NEW.last_name,
        'customer_id', NEW.customer_id,
        'linked_waiver_id', NEW.linked_waiver_id
      ),
      NEW.uploaded_at
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on waiver_uploads
CREATE TRIGGER trigger_waiver_uploads_audit_log
    AFTER INSERT ON waiver_uploads
    FOR EACH ROW
    EXECUTE FUNCTION log_waiver_upload_audit_event();

-- Add comments
COMMENT ON TRIGGER trigger_waiver_signatures_audit_log ON waiver_signatures IS 'Log waiver_signatures events (created, signed, expired) to audit_logs table';
COMMENT ON TRIGGER trigger_waiver_uploads_audit_log ON waiver_uploads IS 'Log waiver_uploads events to audit_logs table';




