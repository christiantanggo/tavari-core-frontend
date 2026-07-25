-- Step 13: Create function waivers_check_expiry
-- Purpose: Check if waiver is still valid (not expired) and update is_valid flag

CREATE OR REPLACE FUNCTION waivers_check_expiry(waiver_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_expires_at TIMESTAMPTZ;
  v_is_valid BOOLEAN;
  v_result BOOLEAN;
BEGIN
  -- Get current expiry status
  SELECT expires_at, is_valid
  INTO v_expires_at, v_is_valid
  FROM waiver_signatures
  WHERE id = waiver_uuid;
  
  -- If waiver not found, return false
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  
  -- If no expiry date, waiver is valid
  IF v_expires_at IS NULL THEN
    v_result := true;
  -- If expiry date is in the past, waiver is expired
  ELSIF v_expires_at <= NOW() THEN
    v_result := false;
    -- Update is_valid flag if it's currently true
    IF v_is_valid = true THEN
      UPDATE waiver_signatures
      SET is_valid = false, updated_at = NOW()
      WHERE id = waiver_uuid;
    END IF;
  -- If expiry date is in the future, waiver is valid
  ELSE
    v_result := true;
    -- Update is_valid flag if it's currently false (waiver was revalidated)
    IF v_is_valid = false THEN
      UPDATE waiver_signatures
      SET is_valid = true, updated_at = NOW()
      WHERE id = waiver_uuid;
    END IF;
  END IF;
  
  RETURN v_result;
END;
$$;

-- Add comment
COMMENT ON FUNCTION waivers_check_expiry IS 'Check if waiver is still valid (not expired) and update is_valid flag automatically';




