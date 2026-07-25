-- Verify your existing custom_voice_agent
-- Your agent already exists! Let's check its details:

INSERT INTO custom_voice_agents (
    business_id,
    name,
    description,
    industry_type,
    phone_number,  -- IMPORTANT: Set this to +15484880543
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
    is_active,  -- Set to true to activate
    is_enabled,
    created_by
)
SELECT 
    business_id,
    name || ' (Custom)',  -- Add suffix to distinguish
    description,
    industry_type,
    '+15484880543' as phone_number,  -- YOUR TELNYX PHONE NUMBER
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
    true as is_active,  -- Activate the agent
    true as is_enabled,
    created_by
FROM voice_agents
WHERE phone_number IS NOT NULL  -- Or use: WHERE name = 'Your Agent Name'
LIMIT 1;  -- Only copy the first matching agent

-- After running, check the new agent:
SELECT id, name, phone_number, is_active 
FROM custom_voice_agents 
WHERE phone_number = '+15484880543';

