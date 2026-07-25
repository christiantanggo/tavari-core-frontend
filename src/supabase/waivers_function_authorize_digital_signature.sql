-- Step 18: Create function waivers_authorize_digital_signature
-- Purpose: Record customer acknowledgment of digital signature authorization

CREATE OR REPLACE FUNCTION waivers_authorize_digital_signature(
  waiver_uuid UUID,
  authorization_acknowledged BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_signature_data JSONB;
  v_updated_signature_data JSONB;
BEGIN
  -- Get current signature_data
  SELECT signature_data
  INTO v_current_signature_data
  FROM waiver_signatures
  WHERE id = waiver_uuid;
  
  -- If waiver not found, return false
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  
  -- Initialize signature_data if null
  IF v_current_signature_data IS NULL THEN
    v_current_signature_data := '{}'::JSONB;
  END IF;
  
  -- Update signature_data with authorization flag
  v_updated_signature_data := v_current_signature_data || jsonb_build_object(
    'digital_signature_authorized', authorization_acknowledged,
    'authorization_acknowledged_at', NOW()
  );
  
  -- Update waiver_signatures
  UPDATE waiver_signatures
  SET 
    signature_data = v_updated_signature_data,
    updated_at = NOW()
  WHERE id = waiver_uuid;
  
  RETURN authorization_acknowledged;
END;
$$;

-- Add comment
COMMENT ON FUNCTION waivers_authorize_digital_signature IS 'Record customer acknowledgment of digital signature authorization in signature_data JSONB field';




