-- Mark all past/inactive calls as "ended"
-- This will update calls that are not currently active, ringing, or in-progress

-- Step 1: Check current status distribution (run this first to see what we're working with)
SELECT 
    status,
    COUNT(*) as count,
    MIN(created_at) as oldest_call,
    MAX(created_at) as newest_call
FROM custom_voice_agent_calls
GROUP BY status
ORDER BY count DESC;

-- Step 2: Update all calls that are NOT already ended/completed
-- This will mark them as "ended" and set ended_at if it's null
UPDATE custom_voice_agent_calls
SET 
    status = 'ended',
    ended_at = COALESCE(ended_at, updated_at, created_at),  -- Use existing ended_at, or updated_at, or created_at
    updated_at = NOW()
WHERE status NOT IN ('ended', 'completed')
   OR status IS NULL;

-- Step 3: Also update calls that might have ended_at but wrong status
UPDATE custom_voice_agent_calls
SET 
    status = 'ended',
    updated_at = NOW()
WHERE ended_at IS NOT NULL
  AND status NOT IN ('ended', 'completed');

-- Step 4: Verify the update
SELECT 
    status,
    COUNT(*) as count
FROM custom_voice_agent_calls
GROUP BY status
ORDER BY count DESC;

-- Step 5: Show sample of updated calls
SELECT 
    id,
    phone_number,
    status,
    created_at,
    ended_at,
    duration_seconds,
    was_answered
FROM custom_voice_agent_calls
ORDER BY created_at DESC
LIMIT 20;


