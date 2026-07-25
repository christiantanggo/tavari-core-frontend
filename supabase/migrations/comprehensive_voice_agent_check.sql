-- COMPREHENSIVE Voice Agent Diagnostic
-- Run this to see the FULL picture

-- 1. Agent Configuration
SELECT 
  'AGENT CONFIG' as check_type,
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

-- 2. Recent Call Records (last 24 hours)
SELECT 
  'RECENT CALLS' as check_type,
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
WHERE agent_id IN (
  SELECT id FROM voice_agents WHERE phone_number = '+15484880543'
)
AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 10;

-- 3. All Webhook Events (last 24 hours)
SELECT 
  'WEBHOOK EVENTS' as check_type,
  event_type,
  COUNT(*) as count,
  MAX(created_at) as most_recent
FROM voice_agent_logs
WHERE agent_id IN (
  SELECT id FROM voice_agents WHERE phone_number = '+15484880543'
)
AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY event_type
ORDER BY most_recent DESC;

-- 4. Errors/Warnings (last 24 hours)
SELECT 
  'ERRORS' as check_type,
  id,
  event_type,
  message,
  severity,
  created_at
FROM voice_agent_logs
WHERE agent_id IN (
  SELECT id FROM voice_agents WHERE phone_number = '+15484880543'
)
AND severity IN ('error', 'warning')
AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 20;

-- 5. Check if assistant.started events created call records
SELECT 
  'CALL RECORD CHECK' as check_type,
  COUNT(*) as total_calls,
  COUNT(CASE WHEN was_answered = true THEN 1 END) as answered_calls,
  COUNT(CASE WHEN status = 'in-progress' THEN 1 END) as in_progress,
  MAX(created_at) as most_recent_call
FROM voice_agent_calls
WHERE agent_id IN (
  SELECT id FROM voice_agents WHERE phone_number = '+15484880543'
);












