-- Create digital_signage_schedule_conflicts table
-- Purpose: Track schedule conflicts
-- Dependencies: FK to businesses, schedules

CREATE TABLE IF NOT EXISTS digital_signage_schedule_conflicts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    schedule_id uuid NOT NULL,
    conflict_schedule_id uuid NOT NULL,
    conflict_type text NOT NULL CHECK (conflict_type IN ('time_overlap', 'screen_overlap', 'zone_overlap')),
    conflict_details jsonb DEFAULT '{}'::jsonb,
    resolved boolean DEFAULT false,
    resolved_at timestamptz,
    resolved_by uuid,
    resolution_notes text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()),
    
    CONSTRAINT digital_signage_schedule_conflicts_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT digital_signage_schedule_conflicts_schedule_id_fkey 
        FOREIGN KEY (schedule_id) 
        REFERENCES digital_signage_schedules(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT digital_signage_schedule_conflicts_conflict_schedule_id_fkey 
        FOREIGN KEY (conflict_schedule_id) 
        REFERENCES digital_signage_schedules(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT digital_signage_schedule_conflicts_resolved_by_fkey 
        FOREIGN KEY (resolved_by) 
        REFERENCES users(id) 
        ON DELETE SET NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_digital_signage_schedule_conflicts_business 
    ON digital_signage_schedule_conflicts(business_id);

CREATE INDEX IF NOT EXISTS idx_digital_signage_schedule_conflicts_resolved 
    ON digital_signage_schedule_conflicts(business_id, resolved) 
    WHERE resolved = false;

-- Enable RLS
ALTER TABLE digital_signage_schedule_conflicts ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE digital_signage_schedule_conflicts IS 'Track schedule conflicts for resolution';



