-- Create audit table for time clock edits
CREATE TABLE IF NOT EXISTS scheduling_time_clocks_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    time_clock_id UUID REFERENCES scheduling_time_clocks(id) ON DELETE CASCADE NOT NULL,
    changed_by UUID REFERENCES users(id) NOT NULL,
    changes JSONB,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_scheduling_time_clocks_audit_time_clock_id ON scheduling_time_clocks_audit(time_clock_id);
CREATE INDEX IF NOT EXISTS idx_scheduling_time_clocks_audit_created_at ON scheduling_time_clocks_audit(created_at DESC);

-- Add comment
COMMENT ON TABLE scheduling_time_clocks_audit IS 'Tracks all changes made to time clock entries';
COMMENT ON COLUMN scheduling_time_clocks_audit.time_clock_id IS 'The time clock entry that was changed';
COMMENT ON COLUMN scheduling_time_clocks_audit.changed_by IS 'The user who made the change';
COMMENT ON COLUMN scheduling_time_clocks_audit.changes IS 'JSON object containing the field changes';
COMMENT ON COLUMN scheduling_time_clocks_audit.reason IS 'Optional reason for the change';

