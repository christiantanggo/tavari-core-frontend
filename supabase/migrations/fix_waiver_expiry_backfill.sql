-- Fix: Backfill expiry dates for existing waivers
-- This migration calculates and sets expires_at for existing waivers that don't have expiry dates
-- It uses the default_expiry_days from waiver_settings or template expiry_days
-- CRITICAL: This fixes existing waivers that were created before the expiry calculation bug was fixed

-- Step 1: Update waivers using global default_expiry_days setting
-- Note: setting_value is JSONB, so we need to extract it properly
UPDATE waiver_signatures ws
SET expires_at = ws.signed_at + INTERVAL '1 day' * COALESCE(
  -- Try to get from global waiver_settings (setting_value is JSONB)
  (SELECT 
    CASE 
      WHEN jsonb_typeof(setting_value) = 'number' THEN (setting_value)::integer
      WHEN jsonb_typeof(setting_value) = 'string' THEN (setting_value::text)::integer
      ELSE NULL
    END
   FROM waiver_settings 
   WHERE business_id = ws.business_id 
     AND setting_key = 'default_expiry_days' 
     AND is_global = true 
     AND template_id IS NULL
   LIMIT 1),
  -- Fallback to template expiry_days
  (SELECT expiry_days 
   FROM waiver_templates 
   WHERE id = ws.template_id 
   LIMIT 1),
  365  -- Default to 365 days if no setting found
),
updated_at = NOW()
WHERE ws.expires_at IS NULL 
  AND ws.signed_at IS NOT NULL;

-- Step 2: Log the update
DO $$
DECLARE
  v_updated_count INTEGER;
  v_total_without_expiry INTEGER;
BEGIN
  -- Count how many were updated
  SELECT COUNT(*) INTO v_updated_count
  FROM waiver_signatures
  WHERE expires_at IS NOT NULL
    AND updated_at > NOW() - INTERVAL '1 minute';
  
  -- Count how many still don't have expiry (should be 0 if all had signed_at)
  SELECT COUNT(*) INTO v_total_without_expiry
  FROM waiver_signatures
  WHERE expires_at IS NULL 
    AND signed_at IS NOT NULL;
  
  RAISE NOTICE '✅ Updated % waivers with expiry dates', v_updated_count;
  RAISE NOTICE '⚠️  % waivers still without expiry (likely unsigned waivers)', v_total_without_expiry;
END $$;

-- Step 3: Verify the update worked
-- This query shows a sample of updated waivers
SELECT 
  id,
  first_name || ' ' || last_name as signer_name,
  signed_at,
  expires_at,
  EXTRACT(EPOCH FROM (expires_at - signed_at))/86400 as days_until_expiry,
  CASE 
    WHEN expires_at < NOW() THEN 'EXPIRED'
    WHEN expires_at IS NULL THEN 'NO EXPIRY'
    ELSE 'VALID'
  END as status
FROM waiver_signatures
WHERE expires_at IS NOT NULL
  AND updated_at > NOW() - INTERVAL '1 minute'
ORDER BY signed_at DESC
LIMIT 10;

-- Add comment
COMMENT ON TABLE waiver_signatures IS 'Backfill script executed to add expiry dates to existing waivers that were created before expiry calculation was fixed';

