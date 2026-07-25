-- Step 14: Create function waivers_create_signature_token
-- Purpose: Generate unique token for waiver signing session
-- Pattern: WV-{business_id_short}-{timestamp}-{random_hash}

CREATE OR REPLACE FUNCTION waivers_create_signature_token(business_uuid UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_token TEXT;
  v_business_id_short TEXT;
  v_timestamp TEXT;
  v_random_hash TEXT;
BEGIN
  -- Get first 8 characters of business_id (without hyphens)
  v_business_id_short := SUBSTRING(REPLACE(business_uuid::TEXT, '-', ''), 1, 8);
  
  -- Get timestamp as hex (Unix timestamp)
  v_timestamp := LPAD(TO_HEX(EXTRACT(EPOCH FROM NOW())::BIGINT), 8, '0');
  
  -- Generate random hash (8 characters)
  v_random_hash := SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 8);
  
  -- Combine: WV-{business_id_short}-{timestamp}-{random_hash}
  v_token := 'WV-' || UPPER(v_business_id_short) || '-' || v_timestamp || '-' || UPPER(v_random_hash);
  
  RETURN v_token;
END;
$$;

-- Add comment
COMMENT ON FUNCTION waivers_create_signature_token IS 'Generate unique token for waiver signing session (format: WV-{business_id}-{timestamp}-{hash})';




