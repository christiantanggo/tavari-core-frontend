-- Drop the existing foreign key constraint
ALTER TABLE scheduling_break_tracking 
DROP CONSTRAINT IF EXISTS scheduling_break_tracking_time_clock_id_fkey;

-- Recreate it pointing to the correct table name
ALTER TABLE scheduling_break_tracking
ADD CONSTRAINT scheduling_break_tracking_time_clock_id_fkey
FOREIGN KEY (time_clock_id) 
REFERENCES scheduling_time_clocks(id) 
ON DELETE CASCADE;

