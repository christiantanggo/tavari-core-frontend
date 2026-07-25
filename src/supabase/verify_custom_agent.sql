-- Verify your custom_voice_agent is set up correctly
-- Run this to check all the details:

SELECT 
    id,
    name,
    phone_number,
    is_active,
    is_enabled,
    system_prompt IS NOT NULL as has_system_prompt,
    business_id,
    model_name,
    voice_id,
    voice_provider
FROM custom_voice_agents 
WHERE phone_number = '+15484880543';

-- If system_prompt is missing or agent is not active, update it:
-- UPDATE custom_voice_agents 
-- SET is_active = true, 
--     is_enabled = true,
--     system_prompt = 'You are a friendly assistant...'  -- Add your prompt
-- WHERE phone_number = '+15484880543';


