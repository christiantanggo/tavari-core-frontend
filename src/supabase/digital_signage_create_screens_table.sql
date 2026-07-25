-- Create digital_signage_screens table
-- Purpose: Registered screens/devices
-- Dependencies: FK to businesses, users, screen_groups, schedules, content

CREATE TABLE IF NOT EXISTS digital_signage_screens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    screen_name text NOT NULL,
    screen_key text UNIQUE,
    screen_type text DEFAULT 'standard' CHECK (screen_type IN ('standard', 'kiosk', 'video_wall')),
    location_name text,
    resolution_width integer,
    resolution_height integer,
    orientation text DEFAULT 'landscape' CHECK (orientation IN ('landscape', 'portrait')),
    group_id uuid,
    current_schedule_id uuid,
    current_content_id uuid,
    status text DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'maintenance')),
    last_seen_at timestamptz,
    settings jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true,
    created_by uuid,
    created_at timestamptz DEFAULT timezone('utc'::text, now()),
    updated_at timestamptz DEFAULT timezone('utc'::text, now()),
    
    CONSTRAINT digital_signage_screens_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT digital_signage_screens_created_by_fkey 
        FOREIGN KEY (created_by) 
        REFERENCES users(id) 
        ON DELETE SET NULL,
    
    CONSTRAINT digital_signage_screens_group_id_fkey 
        FOREIGN KEY (group_id) 
        REFERENCES digital_signage_screen_groups(id) 
        ON DELETE SET NULL,
    
    CONSTRAINT digital_signage_screens_current_schedule_id_fkey 
        FOREIGN KEY (current_schedule_id) 
        REFERENCES digital_signage_schedules(id) 
        ON DELETE SET NULL,
    
    CONSTRAINT digital_signage_screens_current_content_id_fkey 
        FOREIGN KEY (current_content_id) 
        REFERENCES digital_signage_content(id) 
        ON DELETE SET NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_digital_signage_screens_business 
    ON digital_signage_screens(business_id);

CREATE INDEX IF NOT EXISTS idx_digital_signage_screens_business_active 
    ON digital_signage_screens(business_id, is_active) 
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_digital_signage_screens_status 
    ON digital_signage_screens(business_id, status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_digital_signage_screens_key 
    ON digital_signage_screens(screen_key) 
    WHERE screen_key IS NOT NULL;

-- Enable RLS
ALTER TABLE digital_signage_screens ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE digital_signage_screens IS 'Registered digital signage screens/devices';



