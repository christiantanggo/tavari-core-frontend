-- Check why AI isn't speaking even though webhooks are received

-- 1. Check for status-update events (call answered, etc.)
SELECT 
  id,
  event_type,
  message,
  details::text as details_text,
  severity,
  created_at
FROM voice_agent_logs
WHERE agent_id = '31e99ae4-5a14-4c7f-8985-8bacb0ddefcb'
AND (
  event_type LIKE '%status%' 
  OR message LIKE '%answered%'
  OR message LIKE '%status%'
  OR details::text LIKE '%answered%'
  OR details::text LIKE '%status%'
)
ORDER BY created_at DESC
LIMIT 10;

-- 2. Check for any errors or warnings
SELECT 
  id,
  event_type,
  message,
  details::text as details_text,
  severity,
  created_at
FROM voice_agent_logs
WHERE agent_id = '31e99ae4-5a14-4c7f-8985-8bacb0ddefcb'
AND severity IN ('error', 'warning')
ORDER BY created_at DESC
LIMIT 10;

-- 3. Check actual call records - see if calls are being recorded
SELECT 
  id,
  vapi_call_id,
  phone_number,
  direction,
  status,
  started_at,
  ended_at,
  was_answered,
  duration_seconds,
  created_at
FROM voice_agent_calls
WHERE agent_id = '31e99ae4-5a14-4c7f-8985-8bacb0ddefcb'
ORDER BY created_at DESC
LIMIT 5;

-- 4. Check recent webhook events to see what's happening
SELECT 
  id,
  event_type,
  message,
  severity,
  created_at
FROM voice_agent_logs
WHERE agent_id = '31e99ae4-5a14-4c7f-8985-8bacb0ddefcb'
ORDER BY created_at DESC
LIMIT 20;












