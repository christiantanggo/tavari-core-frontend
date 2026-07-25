-- Voice Agent Call Forwarding Configuration
-- Add columns to support forwarding calls to user's own phone number

-- Add forwarding configuration to voice_agents table
ALTER TABLE voice_agents 
    ADD COLUMN IF NOT EXISTS forward_to_phone text, -- Phone number to forward calls to
    ADD COLUMN IF NOT EXISTS forward_ring_count integer DEFAULT 3, -- Number of rings before forwarding
    ADD COLUMN IF NOT EXISTS forward_enabled boolean DEFAULT false; -- Whether forwarding is enabled

COMMENT ON COLUMN voice_agents.forward_to_phone IS 'Phone number to forward calls to (user-owned number)';
COMMENT ON COLUMN voice_agents.forward_ring_count IS 'Number of rings before forwarding to user phone (1-6)';
COMMENT ON COLUMN voice_agents.forward_enabled IS 'Whether call forwarding is enabled';

