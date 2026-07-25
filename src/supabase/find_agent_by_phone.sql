-- Find where your agent is located
-- This will help us understand why it's not showing in the UI

-- Step 1: Find agent by phone number (the one that's answering calls)
-- Replace '+15484880543' with your actual phone number
SELECT 
    'custom_voice_agents' as table_name,
    id,
    name,
    phone_number,
    is_active,
    is_enabled,
    business_id,
    created_at
FROM custom_voice_agents
WHERE phone_number = '+15484880543';  -- Replace with your phone number

-- Step 2: Check if agent exists in old voice_agents table
SELECT 
    'voice_agents' as table_name,
    id,
    name,
    phone_number,
    is_active,
    is_enabled,
    business_id,
    created_at
FROM voice_agents
WHERE phone_number = '+15484880543';  -- Replace with your phone number

-- Step 3: List all agents in custom_voice_agents (to see what business_id they have)
SELECT 
    id,
    name,
    phone_number,
    is_active,
    business_id,
    created_at
FROM custom_voice_agents
ORDER BY created_at DESC;

-- Step 4: Get your current business_id from user_roles
-- Replace 'YOUR_USER_ID' with your actual user ID (from auth.users)
SELECT 
    ur.business_id,
    b.name as business_name,
    ur.role,
    ur.active
FROM user_roles ur
JOIN businesses b ON b.id = ur.business_id
WHERE ur.user_id = auth.uid()  -- This uses the current logged-in user
AND ur.active = true
ORDER BY ur.created_at DESC;

-- Step 5: Check if there's a business_id mismatch
-- If agent exists but with different business_id, we'll need to update it
-- This query shows agents that might need business_id correction
SELECT 
    cva.id,
    cva.name,
    cva.phone_number,
    cva.business_id as agent_business_id,
    b.name as business_name,
    ur.business_id as user_business_id,
    ur.user_id,
    ur.role
FROM custom_voice_agents cva
LEFT JOIN businesses b ON b.id = cva.business_id
LEFT JOIN user_roles ur ON ur.business_id = cva.business_id
WHERE cva.phone_number = '+15484880543'  -- Replace with your phone number
AND ur.user_id = auth.uid();


