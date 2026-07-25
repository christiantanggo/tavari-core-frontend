-- Delete duplicate agent - keep the first one, delete the second
-- This will keep agent: d23e960c-b59c-4b32-ac14-c02c51c9c3d6
-- And delete agent: 23d0f6c0-6ddf-4c8b-867a-57f2f4f737e1

-- First, verify which one to keep:
SELECT id, name, phone_number, created_at 
FROM custom_voice_agents 
WHERE phone_number = '+15484880543'
ORDER BY created_at;

-- Delete the duplicate (the newer one):
DELETE FROM custom_voice_agents 
WHERE id = '23d0f6c0-6ddf-4c8b-867a-57f2f4f737e1';

-- Verify only one remains:
SELECT id, name, phone_number, is_active, is_enabled
FROM custom_voice_agents 
WHERE phone_number = '+15484880543';

-- This will keep agent: d23e960c-b59c-4b32-ac14-c02c51c9c3d6
-- And delete agent: 23d0f6c0-6ddf-4c8b-867a-57f2f4f737e1

-- First, verify which one to keep:
SELECT id, name, phone_number, created_at 
FROM custom_voice_agents 
WHERE phone_number = '+15484880543'
ORDER BY created_at;

-- Delete the duplicate (the newer one):
DELETE FROM custom_voice_agents 
WHERE id = '23d0f6c0-6ddf-4c8b-867a-57f2f4f737e1';

-- Verify only one remains:
SELECT id, name, phone_number, is_active, is_enabled
FROM custom_voice_agents 
WHERE phone_number = '+15484880543';


