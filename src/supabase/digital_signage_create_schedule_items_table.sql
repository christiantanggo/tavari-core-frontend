-- Create digital_signage_schedule_items table
-- Purpose: Content items within a schedule
-- Dependencies: FK to digital_signage_schedules, digital_signage_content
-- Note: zone_id FK will be added later after digital_signage_zones table is created

CREATE TABLE IF NOT EXISTS digital_signage_schedule_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id uuid NOT NULL,
    content_id uuid NOT NULL,
    zone_id uuid,
    display_order integer NOT NULL DEFAULT 0,
    duration_seconds integer,
    transition_type text DEFAULT 'fade' CHECK (transition_type IN ('fade', 'slide', 'none')),
    transition_duration_ms integer DEFAULT 500,
    created_at timestamptz DEFAULT timezone('utc'::text, now()),
    
    CONSTRAINT digital_signage_schedule_items_schedule_id_fkey 
        FOREIGN KEY (schedule_id) 
        REFERENCES digital_signage_schedules(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT digital_signage_schedule_items_content_id_fkey 
        FOREIGN KEY (content_id) 
        REFERENCES digital_signage_content(id) 
        ON DELETE CASCADE
);

-- Note: zone_id foreign key will be added in a separate migration file
-- after digital_signage_zones table is created

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_digital_signage_schedule_items_schedule 
    ON digital_signage_schedule_items(schedule_id, display_order);

CREATE INDEX IF NOT EXISTS idx_digital_signage_schedule_items_content 
    ON digital_signage_schedule_items(content_id);

-- Enable RLS
ALTER TABLE digital_signage_schedule_items ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE digital_signage_schedule_items IS 'Content items within schedules';

