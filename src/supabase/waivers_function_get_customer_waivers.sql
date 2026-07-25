-- Step 11: Create function waivers_get_customer_waivers
-- Purpose: Get all waivers for a customer with validity status and participant count

CREATE OR REPLACE FUNCTION waivers_get_customer_waivers(
  customer_uuid UUID,
  business_uuid UUID,
  include_expired BOOLEAN DEFAULT false
)
RETURNS TABLE (
  id UUID,
  business_id UUID,
  template_id UUID,
  template_name TEXT,
  signature_token TEXT,
  first_name TEXT,
  last_name TEXT,
  date_of_birth DATE,
  phone_number TEXT,
  email TEXT,
  is_minor BOOLEAN,
  is_valid BOOLEAN,
  signed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  participant_count BIGINT,
  expiry_status TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ws.id,
    ws.business_id,
    ws.template_id,
    wt.template_name,
    ws.signature_token,
    ws.first_name,
    ws.last_name,
    ws.date_of_birth,
    ws.phone_number,
    ws.email,
    ws.is_minor,
    ws.is_valid,
    ws.signed_at,
    ws.expires_at,
    COUNT(wp.id)::BIGINT AS participant_count,
    CASE 
      WHEN ws.expires_at IS NULL THEN 'no_expiry'
      WHEN ws.expires_at > NOW() AND ws.is_valid = true THEN 'valid'
      WHEN ws.expires_at <= NOW() OR ws.is_valid = false THEN 'expired'
      ELSE 'unknown'
    END AS expiry_status
  FROM waiver_signatures ws
  LEFT JOIN waiver_templates wt ON ws.template_id = wt.id
  LEFT JOIN waiver_participants wp ON ws.id = wp.waiver_id
  WHERE ws.customer_id = customer_uuid
    AND ws.business_id = business_uuid
    AND (include_expired = true OR ws.is_valid = true OR ws.expires_at IS NULL OR ws.expires_at > NOW())
  GROUP BY ws.id, wt.template_name
  ORDER BY ws.signed_at DESC;
END;
$$;

-- Add comment
COMMENT ON FUNCTION waivers_get_customer_waivers IS 'Get all waivers for a customer with validity status and participant count';




