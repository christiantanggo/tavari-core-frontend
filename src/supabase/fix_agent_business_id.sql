-- Fix agent business_id if it's incorrect
-- Run this AFTER you've identified the issue using find_agent_by_phone.sql

-- Option 1: If agent exists in custom_voice_agents but with wrong business_id
-- Replace 'AGENT_ID_HERE' with the agent's ID
-- Replace 'CORRECT_BUSINESS_ID_HERE' with your actual business_id
UPDATE custom_voice_agents
SET business_id = 'CORRECT_BUSINESS_ID_HERE'  -- Replace with your business_id
WHERE id = 'AGENT_ID_HERE';  -- Replace with agent ID

-- Option 2: If agent is in voice_agents table, copy it to custom_voice_agents
-- This will create a new agent in custom_voice_agents from the old table
-- Replace 'CORRECT_BUSINESS_ID_HERE' with your actual business_id
-- Replace '+15484880543' with your phone number
INSERT INTO custom_voice_agents (
    business_id,
    name,
    description,
    industry_type,
    phone_number,
    system_prompt,
    first_message,
    voice_provider,
    voice_id,
    model_provider,
    model_name,
    temperature,
    max_tokens,
    business_name,
    business_hours,
    business_address,
    business_phone,
    services_config,
    functions_config,
    is_active,
    is_enabled,
    created_by
)
SELECT 
    'CORRECT_BUSINESS_ID_HERE' as business_id,  -- Replace with your business_id
    name || ' (Custom)',  -- Add suffix to distinguish
    description,
    industry_type,
    phone_number,
    system_prompt,
    first_message,
    'openai' as voice_provider,  -- Changed from 11labs to openai
    'alloy' as voice_id,  -- Changed from jennifer to alloy (OpenAI voice)
    model_provider,
    'gpt-4o-realtime-preview-2024-10-01' as model_name,  -- Changed to Realtime model
    temperature,
    max_tokens,
    business_name,
    business_hours,
    business_address,
    business_phone,
    services_config,
    functions_config,
    is_active,  -- Keep the same active status
    is_enabled,
    created_by
FROM voice_agents
WHERE phone_number = '+15484880543'  -- Replace with your phone number
AND NOT EXISTS (
    -- Don't copy if already exists in custom_voice_agents
    SELECT 1 FROM custom_voice_agents cva
    WHERE cva.phone_number = voice_agents.phone_number
    AND cva.business_id = 'CORRECT_BUSINESS_ID_HERE'  -- Replace with your business_id
);

-- Option 3: Verify the fix worked
SELECT 
    id,
    name,
    phone_number,
    is_active,
    business_id,
    created_at
FROM custom_voice_agents
WHERE phone_number = '+15484880543'  -- Replace with your phone number
ORDER BY created_at DESC;


