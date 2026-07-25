-- Check for agents in both tables to see where they exist
-- This will help us understand why agents aren't showing in the UI

-- 1. Check custom_voice_agents table (the new table)
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
ORDER BY created_at DESC;

-- 2. Check voice_agents table (the old VAPI table)
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
WHERE phone_number IS NOT NULL
ORDER BY created_at DESC;

-- 3. Check what business_id you're currently using
-- Replace 'YOUR_BUSINESS_ID_HERE' with your actual business ID
-- You can find this in the browser console when loading the dashboard
SELECT 
    id as business_id,
    name as business_name
FROM businesses
ORDER BY created_at DESC
LIMIT 5;

-- 4. Check if there are any agents for your business in custom_voice_agents
-- Replace 'YOUR_BUSINESS_ID_HERE' with your actual business ID
SELECT 
    id,
    name,
    phone_number,
    is_active,
    is_enabled,
    business_id
FROM custom_voice_agents
-- WHERE business_id = 'YOUR_BUSINESS_ID_HERE'  -- Uncomment and add your business ID
ORDER BY created_at DESC;


