-- Create digital_signage_schedules table
-- Purpose: Schedule content playback on screens
-- Dependencies: None (only FK to businesses and users)

CREATE TABLE IF NOT EXISTS digital_signage_schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    schedule_name text NOT NULL,
    schedule_type text NOT NULL CHECK (schedule_type IN ('playlist', 'time_based', 'event_based')),
    start_date date,
    end_date date,
    start_time time without time zone,
    end_time time without time zone,
    days_of_week integer[],
    timezone text DEFAULT 'America/Toronto',
    priority integer DEFAULT 1,
    apply_to_screens uuid[],
    apply_to_groups uuid[],
    apply_to_zones uuid[],
    holiday_rules jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true,
    created_by uuid,
    created_at timestamptz DEFAULT timezone('utc'::text, now()),
    updated_at timestamptz DEFAULT timezone('utc'::text, now()),
    
    CONSTRAINT digital_signage_schedules_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT digital_signage_schedules_created_by_fkey 
        FOREIGN KEY (created_by) 
        REFERENCES users(id) 
        ON DELETE SET NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_digital_signage_schedules_business 
    ON digital_signage_schedules(business_id);

CREATE INDEX IF NOT EXISTS idx_digital_signage_schedules_business_active 
    ON digital_signage_schedules(business_id, is_active, start_date, end_date) 
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_digital_signage_schedules_dates 
    ON digital_signage_schedules(start_date, end_date) 
    WHERE start_date IS NOT NULL;

-- Enable RLS
ALTER TABLE digital_signage_schedules ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE digital_signage_schedules IS 'Schedules for content playback on screens';



