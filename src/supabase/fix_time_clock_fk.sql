-- Drop the incorrect foreign key
ALTER TABLE scheduling_break_tracking 
DROP CONSTRAINT IF EXISTS scheduling_break_tracking_time_clock_id_fkey;

-- Recreate it pointing to the correct table (scheduling_time_clocks with 's')
ALTER TABLE scheduling_break_tracking
ADD CONSTRAINT scheduling_break_tracking_time_clock_id_fkey
FOREIGN KEY (time_clock_id) 
REFERENCES scheduling_time_clocks(id) 
ON DELETE CASCADE;

