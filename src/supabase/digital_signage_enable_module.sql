-- Enable Digital Signage module for businesses
-- This enables the Digital Signage module in the Tavari system (NOT App Builder)
-- Run this SQL in Supabase to enable Digital Signage for your business

-- Option 1: Enable for a specific business (replace 'YOUR_BUSINESS_ID' with actual UUID)
-- To find your business_id, run: SELECT id, name FROM businesses;
INSERT INTO business_module_usage (business_id, module_key, module_name, enabled, created_at, updated_at)
VALUES (
  'YOUR_BUSINESS_ID'::uuid,  -- Replace with your actual business UUID
  'digital_signage',
  'Digital Signage',
  true,
  NOW(),
  NOW()
)
ON CONFLICT (business_id, module_key) 
DO UPDATE SET enabled = true, updated_at = NOW();

-- Option 2: Enable for ALL existing businesses (uncomment to use)
-- INSERT INTO business_module_usage (business_id, module_key, module_name, enabled, created_at, updated_at)
-- SELECT 
--   id as business_id,
--   'digital_signage' as module_key,
--   'Digital Signage' as module_name,
--   true as enabled,
--   NOW() as created_at,
--   NOW() as updated_at
-- FROM businesses
-- WHERE id NOT IN (
--   SELECT business_id 
--   FROM business_module_usage 
--   WHERE module_key = 'digital_signage'
-- )
-- ON CONFLICT (business_id, module_key) 
-- DO UPDATE SET enabled = true, updated_at = NOW();

