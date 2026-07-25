-- Create hr_policies table for storing HR policies
-- Similar structure to hr_contracts but for policies

CREATE TABLE IF NOT EXISTS hr_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  policy_name TEXT NOT NULL,
  policy_version TEXT DEFAULT '1.0',
  policy_type TEXT, -- e.g., 'Employee Handbook', 'Code of Conduct', 'Safety Policy', etc.
  policy_content TEXT NOT NULL, -- Full policy text/content
  policy_html TEXT, -- HTML formatted version for PDF generation
  pdf_data BYTEA, -- Stored PDF as bytea (optional, can be generated on demand)
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived', 'expired')),
  effective_date DATE,
  expiry_date DATE,
  requires_acknowledgment BOOLEAN DEFAULT true,
  acknowledgment_deadline_days INTEGER DEFAULT 30, -- Days from assignment to acknowledge
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_hr_policies_business_id ON hr_policies(business_id);
CREATE INDEX IF NOT EXISTS idx_hr_policies_status ON hr_policies(status);
CREATE INDEX IF NOT EXISTS idx_hr_policies_created_at ON hr_policies(created_at DESC);

-- Create policy_assignments table to track which employees have been assigned policies
CREATE TABLE IF NOT EXISTS hr_policy_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES hr_policies(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES users(id) ON DELETE CASCADE,
  employee_email TEXT, -- For non-employee recipients
  assigned_by UUID REFERENCES auth.users(id),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  due_date DATE, -- Deadline for acknowledgment
  acknowledged BOOLEAN DEFAULT false,
  acknowledged_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for policy assignments
CREATE INDEX IF NOT EXISTS idx_hr_policy_assignments_policy_id ON hr_policy_assignments(policy_id);
CREATE INDEX IF NOT EXISTS idx_hr_policy_assignments_employee_id ON hr_policy_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_hr_policy_assignments_employee_email ON hr_policy_assignments(employee_email);
CREATE INDEX IF NOT EXISTS idx_hr_policy_assignments_acknowledged ON hr_policy_assignments(acknowledged);

-- Enable RLS
ALTER TABLE hr_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_policy_assignments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for hr_policies
-- Users can view policies for their business
CREATE POLICY "Users can view policies for their business"
  ON hr_policies FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.business_id = hr_policies.business_id
      AND user_roles.user_id = auth.uid()
      AND (user_roles.active = true OR user_roles.active IS NULL)
    )
    OR EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = hr_policies.business_id
      AND business_users.user_id = auth.uid()
    )
  );

-- Users with elevated roles can create policies
CREATE POLICY "Elevated users can create policies"
  ON hr_policies FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.business_id = hr_policies.business_id
      AND user_roles.user_id = auth.uid()
      AND user_roles.role IN ('owner', 'manager', 'admin', 'hr_admin')
      AND (user_roles.active = true OR user_roles.active IS NULL)
    )
  );

-- Users with elevated roles can update policies
CREATE POLICY "Elevated users can update policies"
  ON hr_policies FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.business_id = hr_policies.business_id
      AND user_roles.user_id = auth.uid()
      AND user_roles.role IN ('owner', 'manager', 'admin', 'hr_admin')
      AND (user_roles.active = true OR user_roles.active IS NULL)
    )
  );

-- Users with elevated roles can delete policies
CREATE POLICY "Elevated users can delete policies"
  ON hr_policies FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.business_id = hr_policies.business_id
      AND user_roles.user_id = auth.uid()
      AND user_roles.role IN ('owner', 'manager', 'admin', 'hr_admin')
      AND (user_roles.active = true OR user_roles.active IS NULL)
    )
  );

-- RLS Policies for hr_policy_assignments
-- Users can view assignments for their business
CREATE POLICY "Users can view policy assignments for their business"
  ON hr_policy_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM hr_policies
      WHERE hr_policies.id = hr_policy_assignments.policy_id
      AND (
        EXISTS (
          SELECT 1 FROM user_roles
          WHERE user_roles.business_id = hr_policies.business_id
          AND user_roles.user_id = auth.uid()
          AND (user_roles.active = true OR user_roles.active IS NULL)
        )
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = hr_policies.business_id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  );

-- Users with elevated roles can create assignments
CREATE POLICY "Elevated users can create policy assignments"
  ON hr_policy_assignments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM hr_policies
      WHERE hr_policies.id = hr_policy_assignments.policy_id
      AND EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_roles.business_id = hr_policies.business_id
        AND user_roles.user_id = auth.uid()
        AND user_roles.role IN ('owner', 'manager', 'admin', 'hr_admin')
        AND (user_roles.active = true OR user_roles.active IS NULL)
      )
    )
  );

-- Users with elevated roles can update assignments
CREATE POLICY "Elevated users can update policy assignments"
  ON hr_policy_assignments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM hr_policies
      WHERE hr_policies.id = hr_policy_assignments.policy_id
      AND EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_roles.business_id = hr_policies.business_id
        AND user_roles.user_id = auth.uid()
        AND user_roles.role IN ('owner', 'manager', 'admin', 'hr_admin')
        AND (user_roles.active = true OR user_roles.active IS NULL)
      )
    )
  );

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_hr_policies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_hr_policies_updated_at
  BEFORE UPDATE ON hr_policies
  FOR EACH ROW
  EXECUTE FUNCTION update_hr_policies_updated_at();



