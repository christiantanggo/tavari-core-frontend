-- Check call status and function calls to see why AI isn't responding

-- 1. Check for status-update events (call answered, etc.)
SELECT 
  id,
  event_type,
  message,
  details,
  severity,
  created_at
FROM voice_agent_logs
WHERE agent_id IN (
  SELECT id FROM voice_agents WHERE phone_number = '+15484880543'
)
AND (
  event_type LIKE '%status%' 
  OR event_type LIKE '%answered%'
  OR event_type LIKE '%function%'
  OR message LIKE '%status%'
  OR message LIKE '%answered%'
  OR message LIKE '%function%'
)
ORDER BY created_at DESC
LIMIT 20;

-- 2. Check for any errors
SELECT 
  id,
  event_type,
  message,
  details,
  severity,
  created_at
FROM voice_agent_logs
WHERE agent_id IN (
  SELECT id FROM voice_agents WHERE phone_number = '+15484880543'
)
AND severity IN ('error', 'warning')
ORDER BY created_at DESC
LIMIT 20;

-- 3. Check actual call records
SELECT 
  id,
  vapi_call_id,
  phone_number,
  direction,
  status,
  started_at,
  ended_at,
  was_answered,
  metadata,
  created_at
FROM voice_agent_calls
WHERE agent_id IN (
  SELECT id FROM voice_agents WHERE phone_number = '+15484880543'
)
ORDER BY created_at DESC
LIMIT 5;

-- 4. Check if assistant has first_message configured
SELECT 
  id,
  name,
  first_message,
  vapi_assistant_id,
  is_active,
  is_enabled
FROM voice_agents
WHERE phone_number = '+15484880543';












