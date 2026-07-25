-- Create digital_signage_time_rules table
-- Purpose: Time-based rules for schedules
-- Dependencies: FK to digital_signage_schedules

CREATE TABLE IF NOT EXISTS digital_signage_time_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id uuid NOT NULL,
    rule_type text NOT NULL CHECK (rule_type IN ('time_range', 'day_of_week', 'holiday', 'special_event')),
    rule_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT timezone('utc'::text, now()),
    
    CONSTRAINT digital_signage_time_rules_schedule_id_fkey 
        FOREIGN KEY (schedule_id) 
        REFERENCES digital_signage_schedules(id) 
        ON DELETE CASCADE
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_digital_signage_time_rules_schedule 
    ON digital_signage_time_rules(schedule_id, is_active) 
    WHERE is_active = true;

-- Enable RLS
ALTER TABLE digital_signage_time_rules ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE digital_signage_time_rules IS 'Time-based rules for schedules';



