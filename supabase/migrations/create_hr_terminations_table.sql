-- Create hr_terminations table for tracking employee terminations
CREATE TABLE IF NOT EXISTS hr_terminations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  termination_type TEXT NOT NULL CHECK (termination_type IN ('with_cause', 'without_cause', 'layoff')),
  termination_date DATE NOT NULL,
  cause TEXT, -- Required for 'with_cause' type
  notice_period_weeks INTEGER DEFAULT 0,
  termination_pay DECIMAL(10, 2) DEFAULT 0,
  severance_pay DECIMAL(10, 2) DEFAULT 0,
  vacation_pay_owed DECIMAL(10, 2) DEFAULT 0,
  final_pay DECIMAL(10, 2) DEFAULT 0,
  notes TEXT,
  email_sent BOOLEAN DEFAULT false,
  email_sent_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_hr_terminations_business_id ON hr_terminations(business_id);
CREATE INDEX IF NOT EXISTS idx_hr_terminations_employee_id ON hr_terminations(employee_id);
CREATE INDEX IF NOT EXISTS idx_hr_terminations_termination_date ON hr_terminations(termination_date);
CREATE INDEX IF NOT EXISTS idx_hr_terminations_type ON hr_terminations(termination_type);

-- Enable RLS
ALTER TABLE hr_terminations ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view terminations for their business
CREATE POLICY "Users can view terminations for their business"
  ON hr_terminations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = hr_terminations.business_id
      AND business_users.user_id = auth.uid()
    )
  );

-- Only managers/owners can create terminations
CREATE POLICY "Managers can create terminations"
  ON hr_terminations
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = hr_terminations.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
  );

-- Only managers/owners can update terminations
CREATE POLICY "Managers can update terminations"
  ON hr_terminations
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = hr_terminations.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
  );

-- Only owners can delete terminations
CREATE POLICY "Owners can delete terminations"
  ON hr_terminations
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = hr_terminations.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role = 'owner'
    )
  );

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_hr_terminations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_hr_terminations_updated_at
  BEFORE UPDATE ON hr_terminations
  FOR EACH ROW
  EXECUTE FUNCTION update_hr_terminations_updated_at();

