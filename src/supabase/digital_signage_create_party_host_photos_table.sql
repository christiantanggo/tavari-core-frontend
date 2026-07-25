-- Create digital_signage_party_host_photos table
-- This table stores photos uploaded by parents for party displays

CREATE TABLE IF NOT EXISTS digital_signage_party_host_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    party_host_id UUID NOT NULL REFERENCES digital_signage_party_hosts(id) ON DELETE CASCADE,
    
    -- Photo details
    photo_url TEXT NOT NULL, -- URL to photo in storage
    photo_path TEXT NOT NULL, -- Path in storage bucket
    file_name TEXT NOT NULL,
    file_size BIGINT,
    mime_type TEXT,
    
    -- Display settings
    display_order INTEGER DEFAULT 0,
    caption TEXT, -- Optional caption for the photo
    child_name TEXT, -- Name of child in photo (optional)
    
    -- Upload info
    uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    uploaded_by_name TEXT, -- Name of person who uploaded (parent, staff, etc.)
    
    -- Status
    is_approved BOOLEAN DEFAULT true, -- Staff can approve/reject photos
    is_active BOOLEAN DEFAULT true,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_party_host_photos_business_id ON digital_signage_party_host_photos(business_id);
CREATE INDEX IF NOT EXISTS idx_party_host_photos_party_host_id ON digital_signage_party_host_photos(party_host_id);
CREATE INDEX IF NOT EXISTS idx_party_host_photos_display_order ON digital_signage_party_host_photos(party_host_id, display_order);
CREATE INDEX IF NOT EXISTS idx_party_host_photos_is_active ON digital_signage_party_host_photos(is_active);

-- Add updated_at trigger
DROP TRIGGER IF EXISTS update_party_host_photos_updated_at ON digital_signage_party_host_photos;
CREATE TRIGGER update_party_host_photos_updated_at
    BEFORE UPDATE ON digital_signage_party_host_photos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

