-- Create scheduling_break_tracking table
CREATE TABLE IF NOT EXISTS scheduling_break_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  time_clock_id UUID NOT NULL REFERENCES scheduling_time_clocks(id) ON DELETE CASCADE,
  break_type TEXT CHECK (break_type IN ('paid', 'unpaid', 'meal')) DEFAULT 'unpaid',
  break_start_at TIMESTAMP DEFAULT timezone('utc'::text, now()) NOT NULL,
  break_end_at TIMESTAMP,
  duration_minutes INTEGER,
  is_paid BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP DEFAULT timezone('utc'::text, now())
);

-- Enable RLS
ALTER TABLE scheduling_break_tracking ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read/write their own break records
CREATE POLICY "Users can view their own break records"
  ON scheduling_break_tracking
  FOR SELECT
  USING (auth.uid() = employee_id OR auth.uid() IN (
    SELECT user_id FROM user_roles WHERE business_id = scheduling_break_tracking.business_id 
    AND role IN ('owner', 'manager') AND active = true
  ));

CREATE POLICY "Users can insert their own break records"
  ON scheduling_break_tracking
  FOR INSERT
  WITH CHECK (auth.uid() = employee_id);

CREATE POLICY "Users can update their own break records"
  ON scheduling_break_tracking
  FOR UPDATE
  USING (auth.uid() = employee_id);

CREATE POLICY "Managers can manage all break records"
  ON scheduling_break_tracking
  FOR ALL
  USING (auth.uid() IN (
    SELECT user_id FROM user_roles WHERE business_id = scheduling_break_tracking.business_id 
    AND role IN ('owner', 'manager') AND active = true
  ));

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_break_tracking_employee ON scheduling_break_tracking(employee_id);
CREATE INDEX IF NOT EXISTS idx_break_tracking_business ON scheduling_break_tracking(business_id);
CREATE INDEX IF NOT EXISTS idx_break_tracking_time_clock ON scheduling_break_tracking(time_clock_id);
CREATE INDEX IF NOT EXISTS idx_break_tracking_dates ON scheduling_break_tracking(break_start_at, break_end_at);

