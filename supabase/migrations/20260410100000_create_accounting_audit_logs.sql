CREATE TABLE IF NOT EXISTS accounting_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounting_audit_logs_business_created_at
  ON accounting_audit_logs (business_id, created_at DESC);

ALTER TABLE accounting_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view accounting audit logs for their business" ON accounting_audit_logs;
CREATE POLICY "Users can view accounting audit logs for their business"
  ON accounting_audit_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM business_users
      WHERE business_users.business_id = accounting_audit_logs.business_id
        AND business_users.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Managers can insert accounting audit logs" ON accounting_audit_logs;
CREATE POLICY "Managers can insert accounting audit logs"
  ON accounting_audit_logs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM business_users
      WHERE business_users.business_id = accounting_audit_logs.business_id
        AND business_users.user_id = auth.uid()
        AND business_users.role IN ('owner', 'manager', 'admin')
    )
  );
