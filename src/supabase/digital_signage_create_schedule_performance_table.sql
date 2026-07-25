-- Create digital_signage_schedule_performance table
-- Purpose: Track schedule performance metrics
-- Dependencies: FK to businesses, schedules

CREATE TABLE IF NOT EXISTS digital_signage_schedule_performance (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    schedule_id uuid NOT NULL,
    performance_date date NOT NULL,
    total_playbacks integer DEFAULT 0,
    total_duration_seconds integer DEFAULT 0,
    unique_screens integer DEFAULT 0,
    average_playback_duration_seconds numeric(10, 2),
    completion_rate numeric(5, 2),
    error_count integer DEFAULT 0,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT timezone('utc'::text, now()),
    updated_at timestamptz DEFAULT timezone('utc'::text, now()),
    
    CONSTRAINT digital_signage_schedule_performance_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT digital_signage_schedule_performance_schedule_id_fkey 
        FOREIGN KEY (schedule_id) 
        REFERENCES digital_signage_schedules(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT digital_signage_schedule_performance_unique_date 
        UNIQUE (schedule_id, performance_date)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_digital_signage_schedule_performance_business 
    ON digital_signage_schedule_performance(business_id);

CREATE INDEX IF NOT EXISTS idx_digital_signage_schedule_performance_schedule 
    ON digital_signage_schedule_performance(schedule_id, performance_date DESC);

CREATE INDEX IF NOT EXISTS idx_digital_signage_schedule_performance_date 
    ON digital_signage_schedule_performance(business_id, performance_date DESC);

-- Enable RLS
ALTER TABLE digital_signage_schedule_performance ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE digital_signage_schedule_performance IS 'Track schedule performance metrics for analytics';



