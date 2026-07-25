-- Accounting MVP: vendors per business (unique business_id + lower(name))

CREATE TABLE IF NOT EXISTS accounting_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_from_transaction BOOLEAN NOT NULL DEFAULT false,
  default_expense_category_id UUID REFERENCES accounting_expense_categories(id) ON DELETE SET NULL,
  default_gl_account_erpnext TEXT,
  default_hst_treatment TEXT CHECK (default_hst_treatment IN ('recoverable', 'collected', 'included', 'exempt')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_vendors_business_name_lower ON accounting_vendors(business_id, lower(trim(name)));
CREATE INDEX IF NOT EXISTS idx_accounting_vendors_business_id ON accounting_vendors(business_id);

CREATE OR REPLACE FUNCTION update_accounting_vendors_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_accounting_vendors_updated_at ON accounting_vendors;
CREATE TRIGGER trg_accounting_vendors_updated_at
  BEFORE UPDATE ON accounting_vendors
  FOR EACH ROW
  EXECUTE FUNCTION update_accounting_vendors_updated_at();

ALTER TABLE accounting_vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view vendors for their business" ON accounting_vendors;
CREATE POLICY "Users can view vendors for their business"
  ON accounting_vendors FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_vendors.business_id AND business_users.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Managers can manage vendors" ON accounting_vendors;
CREATE POLICY "Managers can manage vendors"
  ON accounting_vendors FOR ALL
  USING (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_vendors.business_id AND business_users.user_id = auth.uid() AND business_users.role IN ('owner', 'manager', 'admin'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_vendors.business_id AND business_users.user_id = auth.uid() AND business_users.role IN ('owner', 'manager', 'admin'))
  );
