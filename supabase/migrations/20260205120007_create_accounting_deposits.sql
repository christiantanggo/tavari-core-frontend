-- Accounting MVP: deposits (group multiple batches) + deposit_batches join; add FK on sales_batches.deposit_id

CREATE TABLE IF NOT EXISTS accounting_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  deposit_date DATE NOT NULL,
  total_amount NUMERIC(14,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'posted')),
  bank_account_erpnext TEXT,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  erpnext_journal_entry_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounting_deposits_business_id ON accounting_deposits(business_id);
CREATE INDEX IF NOT EXISTS idx_accounting_deposits_status ON accounting_deposits(business_id, status);
CREATE INDEX IF NOT EXISTS idx_accounting_deposits_deposit_date ON accounting_deposits(business_id, deposit_date DESC);

CREATE OR REPLACE FUNCTION update_accounting_deposits_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_accounting_deposits_updated_at ON accounting_deposits;
CREATE TRIGGER trg_accounting_deposits_updated_at
  BEFORE UPDATE ON accounting_deposits
  FOR EACH ROW
  EXECUTE FUNCTION update_accounting_deposits_updated_at();

ALTER TABLE accounting_deposits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view deposits for their business" ON accounting_deposits;
CREATE POLICY "Users can view deposits for their business"
  ON accounting_deposits FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_deposits.business_id AND business_users.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Managers can manage deposits" ON accounting_deposits;
CREATE POLICY "Managers can manage deposits"
  ON accounting_deposits FOR ALL
  USING (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_deposits.business_id AND business_users.user_id = auth.uid() AND business_users.role IN ('owner', 'manager', 'admin'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_deposits.business_id AND business_users.user_id = auth.uid() AND business_users.role IN ('owner', 'manager', 'admin'))
  );

-- Join table: deposit <-> batches
CREATE TABLE IF NOT EXISTS accounting_deposit_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id UUID NOT NULL REFERENCES accounting_deposits(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES accounting_sales_batches(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(deposit_id, batch_id)
);

CREATE INDEX IF NOT EXISTS idx_accounting_deposit_batches_deposit_id ON accounting_deposit_batches(deposit_id);
CREATE INDEX IF NOT EXISTS idx_accounting_deposit_batches_batch_id ON accounting_deposit_batches(batch_id);

ALTER TABLE accounting_deposit_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view deposit batches for their business" ON accounting_deposit_batches;
CREATE POLICY "Users can view deposit batches for their business"
  ON accounting_deposit_batches FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM accounting_deposits d
      JOIN business_users bu ON bu.business_id = d.business_id AND bu.user_id = auth.uid()
      WHERE d.id = accounting_deposit_batches.deposit_id
    )
  );

DROP POLICY IF EXISTS "Managers can manage deposit batches" ON accounting_deposit_batches;
CREATE POLICY "Managers can manage deposit batches"
  ON accounting_deposit_batches FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM accounting_deposits d
      JOIN business_users bu ON bu.business_id = d.business_id AND bu.user_id = auth.uid() AND bu.role IN ('owner', 'manager', 'admin')
      WHERE d.id = accounting_deposit_batches.deposit_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounting_deposits d
      JOIN business_users bu ON bu.business_id = d.business_id AND bu.user_id = auth.uid() AND bu.role IN ('owner', 'manager', 'admin')
      WHERE d.id = accounting_deposit_batches.deposit_id
    )
  );

-- Add FK from sales_batches.deposit_id to deposits (created in previous migration)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounting_sales_batches_deposit_id_fkey'
  ) THEN
    ALTER TABLE accounting_sales_batches
      ADD CONSTRAINT accounting_sales_batches_deposit_id_fkey
      FOREIGN KEY (deposit_id) REFERENCES accounting_deposits(id) ON DELETE SET NULL;
  END IF;
END $$;
