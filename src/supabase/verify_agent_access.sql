-- Verify that you have access to the agent's business
-- This will help us understand why it's not showing in the UI

-- Step 1: Check your user_roles for the agent's business_id
SELECT 
    ur.id,
    ur.user_id,
    ur.business_id,
    ur.role,
    ur.active,
    b.name as business_name
FROM user_roles ur
JOIN businesses b ON b.id = ur.business_id
WHERE ur.business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'  -- Agent's business_id
AND ur.user_id = auth.uid()  -- Your current user
AND ur.active = true;

-- Step 2: Check what business_id is stored in localStorage (this is what the UI uses)
-- You can check this in browser console: localStorage.getItem('currentBusinessId')
-- Or check: localStorage.getItem('selectedBusinessId')

-- Step 3: Verify the agent can be seen with RLS policies
-- This simulates what the frontend query does
SELECT 
    id,
    name,
    phone_number,
    is_active,
    is_enabled,
    business_id
FROM custom_voice_agents
WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'  -- Agent's business_id
ORDER BY created_at DESC;

-- Step 4: Check if there are multiple businesses and which one you're currently viewing
SELECT 
    ur.business_id,
    b.name as business_name,
    ur.role,
    ur.active,
    COUNT(cva.id) as agent_count
FROM user_roles ur
JOIN businesses b ON b.id = ur.business_id
LEFT JOIN custom_voice_agents cva ON cva.business_id = ur.business_id
WHERE ur.user_id = auth.uid()
AND ur.active = true
GROUP BY ur.business_id, b.name, ur.role, ur.active
ORDER BY ur.created_at DESC;


