-- Create scheduling_time_clocks table for time clock kiosk functionality
CREATE TABLE IF NOT EXISTS scheduling_time_clocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
    employee_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    clock_in_time TIMESTAMP WITH TIME ZONE NOT NULL,
    clock_out_time TIMESTAMP WITH TIME ZONE,
    total_hours DECIMAL(10, 2),
    break_duration_minutes INTEGER DEFAULT 0,
    notes TEXT,
    ip_address TEXT,
    device_type TEXT,
    location TEXT,
    photo_verification_url TEXT,
    is_manual_adjustment BOOLEAN DEFAULT FALSE,
    adjusted_by UUID REFERENCES users(id),
    adjustment_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_scheduling_time_clocks_business_id ON scheduling_time_clocks(business_id);
CREATE INDEX IF NOT EXISTS idx_scheduling_time_clocks_employee_id ON scheduling_time_clocks(employee_id);
CREATE INDEX IF NOT EXISTS idx_scheduling_time_clocks_clock_in_time ON scheduling_time_clocks(clock_in_time DESC);
CREATE INDEX IF NOT EXISTS idx_scheduling_time_clocks_open_shifts ON scheduling_time_clocks(employee_id, business_id, clock_out_time) WHERE clock_out_time IS NULL;

-- Add updated_at trigger
CREATE TRIGGER update_scheduling_time_clocks_updated_at
    BEFORE UPDATE ON scheduling_time_clocks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add comments
COMMENT ON TABLE scheduling_time_clocks IS 'Tracks employee clock in/out times for the time clock kiosk';
COMMENT ON COLUMN scheduling_time_clocks.business_id IS 'The business where the employee is clocking in/out';
COMMENT ON COLUMN scheduling_time_clocks.employee_id IS 'The employee who is clocking in/out';
COMMENT ON COLUMN scheduling_time_clocks.clock_in_time IS 'When the employee clocked in';
COMMENT ON COLUMN scheduling_time_clocks.clock_out_time IS 'When the employee clocked out (NULL if still clocked in)';
COMMENT ON COLUMN scheduling_time_clocks.total_hours IS 'Total hours worked (calculated on clock out)';
COMMENT ON COLUMN scheduling_time_clocks.break_duration_minutes IS 'Total break time in minutes';
COMMENT ON COLUMN scheduling_time_clocks.notes IS 'Additional notes about this time entry';
COMMENT ON COLUMN scheduling_time_clocks.ip_address IS 'IP address where the clock in/out occurred';
COMMENT ON COLUMN scheduling_time_clocks.device_type IS 'Type of device (kiosk, mobile, web, etc.)';
COMMENT ON COLUMN scheduling_time_clocks.location IS 'Physical location where the clock in/out occurred';
COMMENT ON COLUMN scheduling_time_clocks.photo_verification_url IS 'URL to photo verification if enabled';
COMMENT ON COLUMN scheduling_time_clocks.is_manual_adjustment IS 'Whether this entry was manually adjusted';
COMMENT ON COLUMN scheduling_time_clocks.adjusted_by IS 'User who made the manual adjustment';
COMMENT ON COLUMN scheduling_time_clocks.adjustment_reason IS 'Reason for the manual adjustment';
