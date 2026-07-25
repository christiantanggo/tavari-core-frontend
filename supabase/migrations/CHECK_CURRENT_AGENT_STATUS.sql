-- CHECK CURRENT AGENT STATUS - RIGHT NOW
-- Run this to see what's actually configured

SELECT 
  id,
  name,
  phone_number,
  vapi_assistant_id,
  vapi_phone_number_id,
  is_active,
  is_enabled,
  first_message,
  CASE 
    WHEN vapi_assistant_id IS NULL THEN '❌ NO ASSISTANT - NEEDS CREATION'
    WHEN vapi_phone_number_id IS NULL THEN '⚠️ NO PHONE CONNECTION - NEEDS RECONNECT'
    WHEN phone_number IS NULL THEN '⚠️ NO PHONE NUMBER'
    WHEN first_message IS NULL OR first_message = '' THEN '⚠️ NO FIRST MESSAGE'
    WHEN is_active = false THEN '⚠️ NOT ACTIVE'
    ELSE '✅ CONFIGURED (BUT MAY NEED REBUILD)'
  END as status,
  created_at,
  updated_at
FROM voice_agents
WHERE phone_number = '+15484880543'
ORDER BY updated_at DESC
LIMIT 1;












