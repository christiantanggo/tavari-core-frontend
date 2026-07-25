-- Step 12: Create function waivers_match_waiver
-- Purpose: Match participant to existing waiver by name, phone, email, DOB with fuzzy matching

CREATE OR REPLACE FUNCTION waivers_match_waiver(
  p_first_name TEXT,
  p_last_name TEXT,
  p_business_uuid UUID,
  p_phone_number TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_date_of_birth DATE DEFAULT NULL
)
RETURNS TABLE (
  waiver_id UUID,
  waiver_status TEXT,
  expiry_date TIMESTAMPTZ,
  match_confidence TEXT,
  matched_fields TEXT[]
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  matched_field_list TEXT[];
  confidence_level TEXT;
BEGIN
  RETURN QUERY
  SELECT 
    ws.id AS waiver_id,
    CASE 
      WHEN ws.expires_at IS NULL THEN 'valid'
      WHEN ws.expires_at > NOW() AND ws.is_valid = true THEN 'valid'
      ELSE 'expired'
    END AS waiver_status,
    ws.expires_at AS expiry_date,
    CASE 
      -- Exact match on all provided fields
      WHEN (p_first_name IS NOT NULL AND LOWER(ws.first_name) = LOWER(p_first_name))
        AND (p_last_name IS NOT NULL AND LOWER(ws.last_name) = LOWER(p_last_name))
        AND (p_phone_number IS NOT NULL AND ws.phone_number = p_phone_number)
        AND (p_email IS NOT NULL AND LOWER(ws.email) = LOWER(p_email))
        AND (p_date_of_birth IS NOT NULL AND ws.date_of_birth = p_date_of_birth)
        THEN 'exact'
      -- High confidence: name + phone + email
      WHEN (p_first_name IS NOT NULL AND LOWER(ws.first_name) = LOWER(p_first_name))
        AND (p_last_name IS NOT NULL AND LOWER(ws.last_name) = LOWER(p_last_name))
        AND (p_phone_number IS NOT NULL AND ws.phone_number = p_phone_number)
        AND (p_email IS NOT NULL AND LOWER(ws.email) = LOWER(p_email))
        THEN 'high'
      -- Medium confidence: name + phone OR name + email
      WHEN (p_first_name IS NOT NULL AND LOWER(ws.first_name) = LOWER(p_first_name))
        AND (p_last_name IS NOT NULL AND LOWER(ws.last_name) = LOWER(p_last_name))
        AND ((p_phone_number IS NOT NULL AND ws.phone_number = p_phone_number)
          OR (p_email IS NOT NULL AND LOWER(ws.email) = LOWER(p_email)))
        THEN 'medium'
      -- Low confidence: name only
      WHEN (p_first_name IS NOT NULL AND LOWER(ws.first_name) = LOWER(p_first_name))
        AND (p_last_name IS NOT NULL AND LOWER(ws.last_name) = LOWER(p_last_name))
        THEN 'low'
      ELSE 'none'
    END AS match_confidence,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN p_first_name IS NOT NULL AND LOWER(ws.first_name) = LOWER(p_first_name) THEN 'first_name' END,
      CASE WHEN p_last_name IS NOT NULL AND LOWER(ws.last_name) = LOWER(p_last_name) THEN 'last_name' END,
      CASE WHEN p_phone_number IS NOT NULL AND ws.phone_number = p_phone_number THEN 'phone_number' END,
      CASE WHEN p_email IS NOT NULL AND LOWER(ws.email) = LOWER(p_email) THEN 'email' END,
      CASE WHEN p_date_of_birth IS NOT NULL AND ws.date_of_birth = p_date_of_birth THEN 'date_of_birth' END
    ], NULL) AS matched_fields
  FROM waiver_signatures ws
  WHERE ws.business_id = p_business_uuid
    AND (
      -- Match on name (required)
      (p_first_name IS NOT NULL AND LOWER(ws.first_name) = LOWER(p_first_name))
      AND (p_last_name IS NOT NULL AND LOWER(ws.last_name) = LOWER(p_last_name))
    )
    AND (
      -- Additional match on phone, email, or DOB
      (p_phone_number IS NOT NULL AND ws.phone_number = p_phone_number)
      OR (p_email IS NOT NULL AND LOWER(ws.email) = LOWER(p_email))
      OR (p_date_of_birth IS NOT NULL AND ws.date_of_birth = p_date_of_birth)
      OR (p_phone_number IS NULL AND p_email IS NULL AND p_date_of_birth IS NULL)
    )
  ORDER BY 
    CASE 
      WHEN (p_phone_number IS NOT NULL AND ws.phone_number = p_phone_number)
        AND (p_email IS NOT NULL AND LOWER(ws.email) = LOWER(p_email))
        AND (p_date_of_birth IS NOT NULL AND ws.date_of_birth = p_date_of_birth) THEN 1
      WHEN (p_phone_number IS NOT NULL AND ws.phone_number = p_phone_number)
        AND (p_email IS NOT NULL AND LOWER(ws.email) = LOWER(p_email)) THEN 2
      WHEN (p_phone_number IS NOT NULL AND ws.phone_number = p_phone_number)
        OR (p_email IS NOT NULL AND LOWER(ws.email) = LOWER(p_email)) THEN 3
      ELSE 4
    END,
    ws.signed_at DESC
  LIMIT 10;
END;
$$;

-- Add comment
COMMENT ON FUNCTION waivers_match_waiver IS 'Match participant to existing waiver by name, phone, email, DOB with confidence scoring';

