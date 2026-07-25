-- Create digital_signage_party_hosts table
-- This table stores party host configurations and sequences

CREATE TABLE IF NOT EXISTS digital_signage_party_hosts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    host_name TEXT NOT NULL,
    host_key TEXT UNIQUE NOT NULL,
    screen_id UUID REFERENCES digital_signage_screens(id) ON DELETE SET NULL,
    
    -- Party event connection
    scheduling_event_id UUID, -- References scheduling_events(id) - no FK to avoid dependency
    
    -- Display settings
    theme_color TEXT DEFAULT '#FF6B9D',
    background_color TEXT DEFAULT '#FFFFFF',
    background_image_url TEXT,
    font_family TEXT DEFAULT 'Arial',
    
    -- Countdown settings
    show_countdown BOOLEAN DEFAULT true,
    countdown_target_time TIMESTAMPTZ, -- When countdown should reach zero
    countdown_label TEXT DEFAULT 'Time Remaining',
    
    -- Photo settings
    allow_photo_uploads BOOLEAN DEFAULT true,
    max_photos INTEGER DEFAULT 20,
    photo_display_duration_seconds INTEGER DEFAULT 5,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    is_published BOOLEAN DEFAULT false,
    
    -- Metadata
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_party_hosts_business_id ON digital_signage_party_hosts(business_id);
CREATE INDEX IF NOT EXISTS idx_party_hosts_screen_id ON digital_signage_party_hosts(screen_id);
CREATE INDEX IF NOT EXISTS idx_party_hosts_scheduling_event_id ON digital_signage_party_hosts(scheduling_event_id);
CREATE INDEX IF NOT EXISTS idx_party_hosts_is_active ON digital_signage_party_hosts(is_active);

-- Add updated_at trigger
DROP TRIGGER IF EXISTS update_party_hosts_updated_at ON digital_signage_party_hosts;
CREATE TRIGGER update_party_hosts_updated_at
    BEFORE UPDATE ON digital_signage_party_hosts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

