-- Add allow_unscheduled_clock_in setting to scheduling_settings table
ALTER TABLE scheduling_settings 
ADD COLUMN IF NOT EXISTS allow_unscheduled_clock_in BOOLEAN DEFAULT true;

COMMENT ON COLUMN scheduling_settings.allow_unscheduled_clock_in IS 'Allow employees to clock in without a scheduled shift';
