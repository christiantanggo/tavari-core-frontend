-- Add photo columns to time clock and break tracking tables
ALTER TABLE scheduling_time_clocks ADD COLUMN IF NOT EXISTS clock_out_photo_url TEXT;
ALTER TABLE scheduling_break_tracking ADD COLUMN IF NOT EXISTS photo_url_start TEXT;
ALTER TABLE scheduling_break_tracking ADD COLUMN IF NOT EXISTS photo_url_end TEXT;

-- Add comments
COMMENT ON COLUMN scheduling_time_clocks.clock_out_photo_url IS 'Photo URL for clock out time';
COMMENT ON COLUMN scheduling_break_tracking.photo_url_start IS 'Photo URL for start of break';
COMMENT ON COLUMN scheduling_break_tracking.photo_url_end IS 'Photo URL for end of break';

