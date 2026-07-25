-- Accounting MVP: exact sender emails allowed to create accounting drafts

CREATE TABLE IF NOT EXISTS accounting_email_whitelist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email_address TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_email_whitelist_business_email ON accounting_email_whitelist(business_id, lower(trim(email_address)));
CREATE INDEX IF NOT EXISTS idx_accounting_email_whitelist_business_id ON accounting_email_whitelist(business_id);

ALTER TABLE accounting_email_whitelist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view email whitelist for their business" ON accounting_email_whitelist;
CREATE POLICY "Users can view email whitelist for their business"
  ON accounting_email_whitelist FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_email_whitelist.business_id AND business_users.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Managers can manage email whitelist" ON accounting_email_whitelist;
CREATE POLICY "Managers can manage email whitelist"
  ON accounting_email_whitelist FOR ALL
  USING (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_email_whitelist.business_id AND business_users.user_id = auth.uid() AND business_users.role IN ('owner', 'manager', 'admin'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_email_whitelist.business_id AND business_users.user_id = auth.uid() AND business_users.role IN ('owner', 'manager', 'admin'))
  );
