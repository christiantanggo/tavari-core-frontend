-- Create digital_signage_zone_content table
-- Purpose: Content assigned to zones
-- Dependencies: FK to digital_signage_zones, digital_signage_content, digital_signage_schedules

CREATE TABLE IF NOT EXISTS digital_signage_zone_content (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_id uuid NOT NULL,
    content_id uuid NOT NULL,
    schedule_id uuid,
    display_order integer DEFAULT 0,
    duration_seconds integer,
    transition_type text DEFAULT 'fade',
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT timezone('utc'::text, now()),
    
    CONSTRAINT digital_signage_zone_content_zone_id_fkey 
        FOREIGN KEY (zone_id) 
        REFERENCES digital_signage_zones(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT digital_signage_zone_content_content_id_fkey 
        FOREIGN KEY (content_id) 
        REFERENCES digital_signage_content(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT digital_signage_zone_content_schedule_id_fkey 
        FOREIGN KEY (schedule_id) 
        REFERENCES digital_signage_schedules(id) 
        ON DELETE SET NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_digital_signage_zone_content_zone 
    ON digital_signage_zone_content(zone_id, display_order, is_active) 
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_digital_signage_zone_content_content 
    ON digital_signage_zone_content(content_id);

-- Enable RLS
ALTER TABLE digital_signage_zone_content ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE digital_signage_zone_content IS 'Content assigned to zones';



