-- Create hr_termination_templates table for managing termination letter templates
CREATE TABLE IF NOT EXISTS hr_termination_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  description TEXT,
  termination_type TEXT CHECK (termination_type IN ('with_cause', 'without_cause', 'layoff', 'all')),
  template_content TEXT NOT NULL, -- HTML content with template variables
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_hr_termination_templates_business_id ON hr_termination_templates(business_id);
CREATE INDEX IF NOT EXISTS idx_hr_termination_templates_type ON hr_termination_templates(termination_type);
CREATE INDEX IF NOT EXISTS idx_hr_termination_templates_active ON hr_termination_templates(business_id, is_active) WHERE is_active = true;

-- Enable RLS
ALTER TABLE hr_termination_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view templates for their business
CREATE POLICY "Users can view termination templates for their business"
  ON hr_termination_templates
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = hr_termination_templates.business_id
      AND business_users.user_id = auth.uid()
    )
  );

-- Only managers/owners can create templates
CREATE POLICY "Managers can create termination templates"
  ON hr_termination_templates
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = hr_termination_templates.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
  );

-- Only managers/owners can update templates
CREATE POLICY "Managers can update termination templates"
  ON hr_termination_templates
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = hr_termination_templates.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
  );

-- Only owners can delete templates
CREATE POLICY "Owners can delete termination templates"
  ON hr_termination_templates
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = hr_termination_templates.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role = 'owner'
    )
  );

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_hr_termination_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_hr_termination_templates_updated_at
  BEFORE UPDATE ON hr_termination_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_hr_termination_templates_updated_at();

-- Template variables documentation:
-- {{EmployeeFirstName}} - Employee's first name
-- {{EmployeeLastName}} - Employee's last name
-- {{EmployeeFullName}} - Employee's full name
-- {{EmployeePosition}} - Employee's position
-- {{EmployeeAddress}} - Employee's address
-- {{EmployeeEmail}} - Employee's email
-- {{StartDate}} - Employee's start/hire date
-- {{TerminationDate}} - Termination date (formatted)
-- {{TerminationDateShort}} - Termination date (short format)
-- {{Cause}} - Reason for termination (with_cause only)
-- {{NoticePeriodWeeks}} - Notice period in weeks
-- {{TerminationPay}} - Termination pay amount
-- {{SeverancePay}} - Severance pay amount
-- {{VacationPayOwed}} - Vacation pay owed
-- {{TotalEntitlement}} - Total entitlement amount
-- {{YearsOfService}} - Years of service
-- {{Notes}} - Additional notes

