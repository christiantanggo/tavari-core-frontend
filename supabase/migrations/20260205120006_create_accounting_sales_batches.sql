-- Accounting MVP: sales batches and batch items (one batch per business per day)

CREATE TABLE IF NOT EXISTS accounting_sales_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  batch_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'posted')),
  total_sales_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_refunds_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  deposit_id UUID, -- FK to accounting_deposits added in 20260205120007
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  erpnext_journal_entry_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(business_id, batch_date)
);

CREATE INDEX IF NOT EXISTS idx_accounting_sales_batches_business_id ON accounting_sales_batches(business_id);
CREATE INDEX IF NOT EXISTS idx_accounting_sales_batches_status ON accounting_sales_batches(business_id, status);
CREATE INDEX IF NOT EXISTS idx_accounting_sales_batches_batch_date ON accounting_sales_batches(business_id, batch_date DESC);

CREATE OR REPLACE FUNCTION update_accounting_sales_batches_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_accounting_sales_batches_updated_at ON accounting_sales_batches;
CREATE TRIGGER trg_accounting_sales_batches_updated_at
  BEFORE UPDATE ON accounting_sales_batches
  FOR EACH ROW
  EXECUTE FUNCTION update_accounting_sales_batches_updated_at();

ALTER TABLE accounting_sales_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view sales batches for their business" ON accounting_sales_batches;
CREATE POLICY "Users can view sales batches for their business"
  ON accounting_sales_batches FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_sales_batches.business_id AND business_users.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Managers can manage sales batches" ON accounting_sales_batches;
CREATE POLICY "Managers can manage sales batches"
  ON accounting_sales_batches FOR ALL
  USING (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_sales_batches.business_id AND business_users.user_id = auth.uid() AND business_users.role IN ('owner', 'manager', 'admin'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_sales_batches.business_id AND business_users.user_id = auth.uid() AND business_users.role IN ('owner', 'manager', 'admin'))
  );

-- Batch items: which POS sales / booking payments are in this batch
CREATE TABLE IF NOT EXISTS accounting_sales_batch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES accounting_sales_batches(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('pos', 'booking')),
  source_id UUID NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(batch_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_accounting_sales_batch_items_batch_id ON accounting_sales_batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_accounting_sales_batch_items_source ON accounting_sales_batch_items(source_type, source_id);

ALTER TABLE accounting_sales_batch_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view batch items for their business" ON accounting_sales_batch_items;
CREATE POLICY "Users can view batch items for their business"
  ON accounting_sales_batch_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM accounting_sales_batches b
      JOIN business_users bu ON bu.business_id = b.business_id AND bu.user_id = auth.uid()
      WHERE b.id = accounting_sales_batch_items.batch_id
    )
  );

DROP POLICY IF EXISTS "Managers can manage batch items" ON accounting_sales_batch_items;
CREATE POLICY "Managers can manage batch items"
  ON accounting_sales_batch_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM accounting_sales_batches b
      JOIN business_users bu ON bu.business_id = b.business_id AND bu.user_id = auth.uid() AND bu.role IN ('owner', 'manager', 'admin')
      WHERE b.id = accounting_sales_batch_items.batch_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounting_sales_batches b
      JOIN business_users bu ON bu.business_id = b.business_id AND bu.user_id = auth.uid() AND bu.role IN ('owner', 'manager', 'admin')
      WHERE b.id = accounting_sales_batch_items.batch_id
    )
  );