-- Accounting MVP: business config (one row per business, ERPNext connection and batch settings)
-- RLS via business_users per build plan §3A

CREATE TABLE IF NOT EXISTS accounting_business_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  erpnext_company_name TEXT,
  erpnext_api_url TEXT NOT NULL,
  erpnext_api_key TEXT,
  erpnext_secret TEXT,
  batch_day_end_time_local TIME,
  batch_run_time_local TIME,
  business_timezone TEXT NOT NULL DEFAULT 'America/Toronto',
  period_lock_type TEXT NOT NULL DEFAULT 'month' CHECK (period_lock_type IN ('month', 'date')),
  period_locked_until DATE,
  bookings_revenue_account_erpnext TEXT,
  pos_revenue_account_erpnext TEXT,
  hst_collected_account_erpnext TEXT,
  currency TEXT NOT NULL DEFAULT 'CAD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounting_business_config_business_id ON accounting_business_config(business_id);

CREATE OR REPLACE FUNCTION update_accounting_business_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_accounting_business_config_updated_at ON accounting_business_config;
CREATE TRIGGER trg_accounting_business_config_updated_at
  BEFORE UPDATE ON accounting_business_config
  FOR EACH ROW
  EXECUTE FUNCTION update_accounting_business_config_updated_at();

ALTER TABLE accounting_business_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view accounting config for their business" ON accounting_business_config;
CREATE POLICY "Users can view accounting config for their business"
  ON accounting_business_config FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = accounting_business_config.business_id
      AND business_users.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Managers can update accounting config" ON accounting_business_config;
CREATE POLICY "Managers can update accounting config"
  ON accounting_business_config FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = accounting_business_config.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = accounting_business_config.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin')
    )
  );

DROP POLICY IF EXISTS "Managers can insert accounting config" ON accounting_business_config;
CREATE POLICY "Managers can insert accounting config"
  ON accounting_business_config FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = accounting_business_config.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin')
    )
  );
