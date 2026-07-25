-- Create digital_signage_party_host_sequences table
-- This table defines the sequence of activities during a party (food, cake, presents, etc.)

CREATE TABLE IF NOT EXISTS digital_signage_party_host_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    party_host_id UUID NOT NULL REFERENCES digital_signage_party_hosts(id) ON DELETE CASCADE,
    
    -- Sequence item details
    sequence_order INTEGER NOT NULL, -- Order in which this activity appears
    activity_name TEXT NOT NULL, -- e.g., "Food Time", "Cake Time", "Present Time"
    activity_type TEXT NOT NULL, -- food, cake, presents, games, photos, custom
    
    -- Timing (relative to party start or absolute)
    start_time_offset_minutes INTEGER DEFAULT 0, -- Minutes after party start
    duration_minutes INTEGER, -- How long this activity should display
    
    -- Display settings
    background_color TEXT,
    background_image_url TEXT,
    display_text TEXT, -- Custom text to display during this activity
    show_countdown BOOLEAN DEFAULT false,
    show_photos BOOLEAN DEFAULT true,
    
    -- Content
    custom_image_url TEXT, -- Custom image for this activity
    custom_message TEXT, -- Custom message to display
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    
    -- Metadata
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure unique sequence order per party host
    UNIQUE(party_host_id, sequence_order)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_party_host_sequences_business_id ON digital_signage_party_host_sequences(business_id);
CREATE INDEX IF NOT EXISTS idx_party_host_sequences_party_host_id ON digital_signage_party_host_sequences(party_host_id);
CREATE INDEX IF NOT EXISTS idx_party_host_sequences_order ON digital_signage_party_host_sequences(party_host_id, sequence_order);

-- Add updated_at trigger
DROP TRIGGER IF EXISTS update_party_host_sequences_updated_at ON digital_signage_party_host_sequences;
CREATE TRIGGER update_party_host_sequences_updated_at
    BEFORE UPDATE ON digital_signage_party_host_sequences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

