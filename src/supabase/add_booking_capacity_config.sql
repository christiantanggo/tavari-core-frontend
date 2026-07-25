-- Add max capacity per time slot configuration
-- This allows businesses to set how many people can book the same time slot

-- Add column to custom_voice_agent_configurations table
ALTER TABLE custom_voice_agent_configurations
ADD COLUMN IF NOT EXISTS max_capacity_per_slot integer DEFAULT 1;

-- Add comment
COMMENT ON COLUMN custom_voice_agent_configurations.max_capacity_per_slot IS 
'Maximum number of bookings allowed per time slot. Default is 1 (one booking per slot). Set to higher number to allow multiple bookings (e.g., group classes, party rooms).';

-- Update existing records to have default value
UPDATE custom_voice_agent_configurations
SET max_capacity_per_slot = 1
WHERE max_capacity_per_slot IS NULL;


