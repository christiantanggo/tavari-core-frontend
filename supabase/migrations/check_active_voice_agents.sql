-- Check if there are any active voice agents with phone numbers configured

-- 1. Check all voice agents and their phone numbers
SELECT 
  id,
  name,
  business_id,
  phone_number,
  vapi_phone_number_id,
  telnyx_connection_id,
  is_active,
  is_enabled,
  created_at
FROM voice_agents
WHERE phone_number IS NOT NULL
ORDER BY created_at DESC;

-- 2. Check only ACTIVE agents with phone numbers
SELECT 
  id,
  name,
  business_id,
  phone_number,
  vapi_phone_number_id,
  is_active,
  is_enabled,
  created_at
FROM voice_agents
WHERE phone_number IS NOT NULL
  AND phone_number != ''
  AND is_active = true
  AND is_enabled = true
ORDER BY created_at DESC;

-- 3. Count active agents by business
SELECT 
  business_id,
  COUNT(*) as active_agents_count,
  STRING_AGG(phone_number, ', ') as phone_numbers
FROM voice_agents
WHERE phone_number IS NOT NULL
  AND phone_number != ''
  AND is_active = true
  AND is_enabled = true
GROUP BY business_id;

-- 4. Check if phone numbers are properly formatted
SELECT 
  id,
  name,
  phone_number,
  CASE 
    WHEN phone_number ~ '^\+?[1-9]\d{1,14}$' THEN 'Valid format'
    WHEN phone_number ~ '^\d{10}$' THEN '10 digits (missing +1)'
    WHEN phone_number ~ '^\+1\d{10}$' THEN 'US format (+1XXXXXXXXXX)'
    ELSE 'Check format'
  END as format_status,
  is_active,
  is_enabled
FROM voice_agents
WHERE phone_number IS NOT NULL
  AND phone_number != '';












