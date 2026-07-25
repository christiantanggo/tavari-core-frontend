-- COMPLETE VOICE AGENT REBUILD SCRIPT
-- Run this to get the FULL picture, then rebuild the agent in the UI

-- Step 1: Check current agent status
SELECT 
  'CURRENT STATUS' as step,
  id,
  name,
  phone_number,
  vapi_assistant_id,
  vapi_phone_number_id,
  is_active,
  is_enabled,
  first_message,
  CASE 
    WHEN vapi_assistant_id IS NULL THEN '❌ NO VAPI ASSISTANT ID'
    WHEN vapi_phone_number_id IS NULL THEN '⚠️ NO PHONE NUMBER ID'
    WHEN phone_number IS NULL THEN '⚠️ NO PHONE NUMBER'
    WHEN first_message IS NULL OR first_message = '' THEN '⚠️ NO FIRST MESSAGE'
    WHEN is_active = false THEN '⚠️ NOT ACTIVE'
    WHEN is_enabled = false THEN '⚠️ NOT ENABLED'
    ELSE '✅ CONFIGURED'
  END as status,
  created_at,
  updated_at
FROM voice_agents
WHERE phone_number = '+15484880543'
ORDER BY created_at DESC
LIMIT 1;

-- Step 2: Check recent webhook activity (last 7 days)
SELECT 
  'WEBHOOK ACTIVITY' as step,
  event_type,
  COUNT(*) as event_count,
  MAX(created_at) as most_recent,
  MIN(created_at) as oldest
FROM voice_agent_logs
WHERE agent_id IN (
  SELECT id FROM voice_agents WHERE phone_number = '+15484880543'
)
AND created_at > NOW() - INTERVAL '7 days'
GROUP BY event_type
ORDER BY most_recent DESC;

-- Step 3: Check call records
SELECT 
  'CALL RECORDS' as step,
  COUNT(*) as total_calls,
  COUNT(CASE WHEN was_answered = true THEN 1 END) as answered,
  COUNT(CASE WHEN status = 'in-progress' THEN 1 END) as in_progress,
  COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
  MAX(created_at) as most_recent_call
FROM voice_agent_calls
WHERE agent_id IN (
  SELECT id FROM voice_agents WHERE phone_number = '+15484880543'
);

-- Step 4: Show errors/warnings
SELECT 
  'ERRORS/WARNINGS' as step,
  event_type,
  message,
  severity,
  created_at
FROM voice_agent_logs
WHERE agent_id IN (
  SELECT id FROM voice_agents WHERE phone_number = '+15484880543'
)
AND severity IN ('error', 'warning')
AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC
LIMIT 10;












