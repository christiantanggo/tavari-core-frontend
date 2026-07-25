-- Create mailboxes table for email inbox management
CREATE TABLE IF NOT EXISTS mailboxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  domain_id UUID REFERENCES mail_domains(id) ON DELETE SET NULL,
  
  -- Mailbox identification
  email_address TEXT NOT NULL,
  display_name TEXT,
  description TEXT,
  
  -- Mailbox type
  mailbox_type TEXT NOT NULL DEFAULT 'individual' CHECK (mailbox_type IN ('individual', 'shared', 'group', 'forwarding')),
  
  -- Assignment
  assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_to_employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Forwarding configuration
  forwarding_enabled BOOLEAN DEFAULT false,
  forwarding_addresses TEXT[], -- Array of email addresses to forward to
  keep_copy BOOLEAN DEFAULT true, -- Keep a copy in the mailbox when forwarding
  
  -- Shared mailbox configuration
  shared_with_user_ids UUID[], -- Array of user IDs who can access this shared mailbox
  shared_with_role_ids UUID[], -- Array of role IDs (for role-based access)
  
  -- Storage and quota
  storage_quota_mb INTEGER DEFAULT 1024, -- Storage quota in MB
  current_storage_mb NUMERIC(10,2) DEFAULT 0,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  
  -- Auto-responder
  auto_responder_enabled BOOLEAN DEFAULT false,
  auto_responder_subject TEXT,
  auto_responder_message TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Constraints
  UNIQUE(business_id, email_address)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mailboxes_business_id ON mailboxes(business_id);
CREATE INDEX IF NOT EXISTS idx_mailboxes_domain_id ON mailboxes(domain_id);
CREATE INDEX IF NOT EXISTS idx_mailboxes_assigned_to_user_id ON mailboxes(assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_mailboxes_assigned_to_employee_id ON mailboxes(assigned_to_employee_id);
CREATE INDEX IF NOT EXISTS idx_mailboxes_status ON mailboxes(status);
CREATE INDEX IF NOT EXISTS idx_mailboxes_email_address ON mailboxes(email_address);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_mailboxes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_mailboxes_updated_at
BEFORE UPDATE ON mailboxes
FOR EACH ROW
EXECUTE FUNCTION update_mailboxes_updated_at();

-- Enable RLS
ALTER TABLE mailboxes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view mailboxes for their business" ON mailboxes;
CREATE POLICY "Users can view mailboxes for their business"
  ON mailboxes FOR SELECT
  USING (
    business_id IN (
      SELECT business_id FROM user_roles 
      WHERE user_id = auth.uid() AND active = true
    )
  );

DROP POLICY IF EXISTS "Users can create mailboxes for their business" ON mailboxes;
CREATE POLICY "Users can create mailboxes for their business"
  ON mailboxes FOR INSERT
  WITH CHECK (
    business_id IN (
      SELECT business_id FROM user_roles 
      WHERE user_id = auth.uid() AND active = true
      AND role IN ('owner', 'admin', 'hr_admin', 'manager')
    )
  );

DROP POLICY IF EXISTS "Users can update mailboxes for their business" ON mailboxes;
CREATE POLICY "Users can update mailboxes for their business"
  ON mailboxes FOR UPDATE
  USING (
    business_id IN (
      SELECT business_id FROM user_roles 
      WHERE user_id = auth.uid() AND active = true
      AND role IN ('owner', 'admin', 'hr_admin', 'manager')
    )
  );

DROP POLICY IF EXISTS "Users can delete mailboxes for their business" ON mailboxes;
CREATE POLICY "Users can delete mailboxes for their business"
  ON mailboxes FOR DELETE
  USING (
    business_id IN (
      SELECT business_id FROM user_roles 
      WHERE user_id = auth.uid() AND active = true
      AND role IN ('owner', 'admin', 'hr_admin', 'manager')
    )
  );

-- Comments
COMMENT ON TABLE mailboxes IS 'Email mailboxes for business domains';
COMMENT ON COLUMN mailboxes.mailbox_type IS 'Type of mailbox: individual, shared, group, or forwarding';
COMMENT ON COLUMN mailboxes.forwarding_addresses IS 'Array of email addresses to forward messages to';
COMMENT ON COLUMN mailboxes.shared_with_user_ids IS 'Array of user IDs who can access this shared mailbox';










