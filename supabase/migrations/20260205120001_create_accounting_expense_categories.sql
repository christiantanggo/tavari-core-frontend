-- Accounting MVP: expense categories per business + baseline seed

CREATE TABLE IF NOT EXISTS accounting_expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  gl_account_erpnext TEXT NOT NULL,
  default_hst_treatment TEXT NOT NULL CHECK (default_hst_treatment IN ('recoverable', 'collected', 'included', 'exempt')),
  is_baseline BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounting_expense_categories_business_id ON accounting_expense_categories(business_id);
CREATE INDEX IF NOT EXISTS idx_accounting_expense_categories_sort ON accounting_expense_categories(business_id, sort_order);

CREATE OR REPLACE FUNCTION update_accounting_expense_categories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_accounting_expense_categories_updated_at ON accounting_expense_categories;
CREATE TRIGGER trg_accounting_expense_categories_updated_at
  BEFORE UPDATE ON accounting_expense_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_accounting_expense_categories_updated_at();

ALTER TABLE accounting_expense_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view expense categories for their business" ON accounting_expense_categories;
CREATE POLICY "Users can view expense categories for their business"
  ON accounting_expense_categories FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_expense_categories.business_id AND business_users.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Managers can manage expense categories" ON accounting_expense_categories;
CREATE POLICY "Managers can manage expense categories"
  ON accounting_expense_categories FOR ALL
  USING (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_expense_categories.business_id AND business_users.user_id = auth.uid() AND business_users.role IN ('owner', 'manager', 'admin'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_expense_categories.business_id AND business_users.user_id = auth.uid() AND business_users.role IN ('owner', 'manager', 'admin'))
  );
