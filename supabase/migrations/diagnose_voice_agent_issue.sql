-- Diagnose why voice agent isn't answering calls

-- 1. Check agent configuration
SELECT 
  id,
  name,
  phone_number,
  vapi_assistant_id,
  vapi_phone_number_id,
  is_active,
  is_enabled,
  first_message,
  created_at,
  updated_at
FROM voice_agents
WHERE phone_number = '+15484880543';

-- 2. Check if there are any recent call attempts
SELECT 
  id,
  vapi_call_id,
  phone_number,
  direction,
  status,
  started_at,
  ended_at,
  metadata,
  created_at
FROM voice_agent_calls
WHERE agent_id IN (
  SELECT id FROM voice_agents WHERE phone_number = '+15484880543'
)
ORDER BY created_at DESC
LIMIT 10;

-- 3. Check webhook logs (if voice_agent_logs table exists)
SELECT 
  id,
  event_type,
  message,
  severity,
  created_at
FROM voice_agent_logs
WHERE agent_id IN (
  SELECT id FROM voice_agents WHERE phone_number = '+15484880543'
)
ORDER BY created_at DESC
LIMIT 20;

