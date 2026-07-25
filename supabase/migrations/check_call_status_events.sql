-- Check for status-update events and call records

-- 1. Check ALL event types to see what we're missing
SELECT 
  event_type,
  COUNT(*) as count,
  MAX(created_at) as most_recent
FROM voice_agent_logs
WHERE agent_id = '31e99ae4-5a14-4c7f-8985-8bacb0ddefcb'
GROUP BY event_type
ORDER BY most_recent DESC;

-- 2. Check for ANY status-related events (broader search)
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
  OR message LIKE '%status%'
  OR message LIKE '%answered%'
  OR message LIKE '%answered%'
  OR details::text LIKE '%answered%'
  OR details::text LIKE '%status%'
  OR details::text LIKE '%"status"%'
)
ORDER BY created_at DESC
LIMIT 20;

-- 3. Check actual call records - see if calls are being created
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
  metadata::text as metadata_text,
  created_at
FROM voice_agent_calls
WHERE agent_id = '31e99ae4-5a14-4c7f-8985-8bacb0ddefcb'
ORDER BY created_at DESC
LIMIT 10;

-- 4. Check if there are any errors
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
LIMIT 20;












