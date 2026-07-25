-- Allow custom_voice_agents to use voice_agent_bookings table
-- This removes the strict foreign key constraint so both agent types can use the same bookings table

-- Step 1: Drop the existing foreign key constraint
ALTER TABLE voice_agent_bookings 
DROP CONSTRAINT IF EXISTS voice_agent_bookings_agent_id_fkey;

-- Step 2: The agent_id column will still exist and work, but won't enforce referential integrity
-- This allows both voice_agents and custom_voice_agents to use the same bookings table
-- The application logic will handle which agent type is being used

-- Step 3: Add a comment explaining the change
COMMENT ON COLUMN voice_agent_bookings.agent_id IS 
'Agent ID - can reference either voice_agents.id or custom_voice_agents.id. Foreign key constraint removed to allow both agent types to use this table.';

-- Note: If you want to maintain referential integrity, you could:
-- 1. Create a unified agents view/table
-- 2. Use a check constraint to validate agent_id exists in either table
-- 3. Handle validation in application code (current approach)


