-- Create scheduling_availability table
CREATE TABLE IF NOT EXISTS scheduling_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  availability_date DATE NOT NULL,
  availability_type TEXT NOT NULL CHECK (availability_type IN ('preferred', 'unavailable')),
  all_day BOOLEAN DEFAULT false,
  start_time TIME,
  end_time TIME,
  start_date DATE NOT NULL,
  end_date DATE,
  is_approved BOOLEAN DEFAULT false,
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  notes TEXT,
  UNIQUE(business_id, employee_id, availability_date)
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_availability_business_id ON scheduling_availability(business_id);
CREATE INDEX IF NOT EXISTS idx_availability_employee_id ON scheduling_availability(employee_id);
CREATE INDEX IF NOT EXISTS idx_availability_date ON scheduling_availability(availability_date);
CREATE INDEX IF NOT EXISTS idx_availability_type ON scheduling_availability(availability_type);

-- Enable RLS
ALTER TABLE scheduling_availability ENABLE ROW LEVEL SECURITY;

-- RLS Policies for scheduling_availability table

-- Employees can view and create their own availability
CREATE POLICY "Employees can view their own availability"
ON scheduling_availability FOR SELECT
USING (
  auth.uid() = employee_id OR
  business_id IN (
    SELECT business_id FROM business_users 
    WHERE user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

-- Employees can create their own availability
CREATE POLICY "Employees can create their own availability"
ON scheduling_availability FOR INSERT
WITH CHECK (
  auth.uid() = employee_id AND
  business_id IN (
    SELECT business_id FROM business_users 
    WHERE user_id = auth.uid()
  )
);

-- Employees can update their own unapproved availability
CREATE POLICY "Employees can update their own availability"
ON scheduling_availability FOR UPDATE
USING (
  auth.uid() = employee_id AND is_approved = false
)
WITH CHECK (
  auth.uid() = employee_id
);

-- Managers and owners can view, approve, and manage all availability
CREATE POLICY "Managers can view all availability"
ON scheduling_availability FOR SELECT
USING (
  business_id IN (
    SELECT business_id FROM business_users 
    WHERE user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

-- Managers can approve availability
CREATE POLICY "Managers can approve availability"
ON scheduling_availability FOR UPDATE
USING (
  business_id IN (
    SELECT business_id FROM business_users 
    WHERE user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
)
WITH CHECK (
  business_id IN (
    SELECT business_id FROM business_users 
    WHERE user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

-- Managers can delete availability
CREATE POLICY "Managers can delete availability"
ON scheduling_availability FOR DELETE
USING (
  business_id IN (
    SELECT business_id FROM business_users 
    WHERE user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

-- Add trigger to update updated_at
CREATE OR REPLACE FUNCTION update_scheduling_availability_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_scheduling_availability_updated_at 
    BEFORE UPDATE ON scheduling_availability 
    FOR EACH ROW 
    EXECUTE FUNCTION update_scheduling_availability_updated_at();
