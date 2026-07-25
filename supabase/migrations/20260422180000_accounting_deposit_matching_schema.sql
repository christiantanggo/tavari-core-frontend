-- Bank deposit matching schema:
-- - store processor/source bucket detail on sales batch items
-- - link imported bank transactions to accounting deposits
-- - persist explicit deposit match lines for batch allocations and manual adjustments

ALTER TABLE accounting_sales_batch_items
  DROP CONSTRAINT IF EXISTS accounting_sales_batch_items_source_type_check;

ALTER TABLE accounting_sales_batch_items
  ADD CONSTRAINT accounting_sales_batch_items_source_type_check
  CHECK (source_type IN ('pos', 'booking', 'pos_payment', 'booking_payment', 'manual_sales'));

ALTER TABLE accounting_sales_batch_items
  ADD COLUMN IF NOT EXISTS source_bucket_key TEXT,
  ADD COLUMN IF NOT EXISTS source_bucket_label TEXT,
  ADD COLUMN IF NOT EXISTS source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_accounting_sales_batch_items_bucket
  ON accounting_sales_batch_items(batch_id, source_bucket_key);

UPDATE accounting_sales_batch_items
SET
  source_bucket_key = COALESCE(NULLIF(source_bucket_key, ''), source_type),
  source_bucket_label = COALESCE(
    NULLIF(source_bucket_label, ''),
    CASE
      WHEN source_type IN ('pos', 'pos_payment') THEN 'POS'
      WHEN source_type IN ('booking', 'booking_payment') THEN 'Bookings'
      ELSE 'Manual sales'
    END
  )
WHERE source_bucket_key IS NULL
   OR source_bucket_key = ''
   OR source_bucket_label IS NULL
   OR source_bucket_label = '';

ALTER TABLE accounting_bank_transactions
  ADD COLUMN IF NOT EXISTS matched_deposit_id UUID REFERENCES accounting_deposits(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_bank_transactions_matched_deposit_id
  ON accounting_bank_transactions(matched_deposit_id)
  WHERE matched_deposit_id IS NOT NULL;

ALTER TABLE accounting_deposits
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE accounting_deposits
  DROP CONSTRAINT IF EXISTS accounting_deposits_source_check;

ALTER TABLE accounting_deposits
  ADD CONSTRAINT accounting_deposits_source_check
  CHECK (source IN ('manual', 'bank_import', 'repair'));

CREATE TABLE IF NOT EXISTS accounting_deposit_match_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  deposit_id UUID NOT NULL REFERENCES accounting_deposits(id) ON DELETE CASCADE,
  line_type TEXT NOT NULL CHECK (line_type IN ('batch_item', 'undeposited_carryover', 'cash_deposit', 'manual_adjustment')),
  batch_id UUID REFERENCES accounting_sales_batches(id) ON DELETE SET NULL,
  batch_item_id UUID REFERENCES accounting_sales_batch_items(id) ON DELETE SET NULL,
  source_type TEXT,
  source_id UUID,
  source_bucket_key TEXT,
  source_bucket_label TEXT,
  description TEXT,
  matched_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  revenue_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounting_deposit_match_lines_deposit_id
  ON accounting_deposit_match_lines(deposit_id);

CREATE INDEX IF NOT EXISTS idx_accounting_deposit_match_lines_batch_id
  ON accounting_deposit_match_lines(batch_id);

CREATE INDEX IF NOT EXISTS idx_accounting_deposit_match_lines_batch_item_id
  ON accounting_deposit_match_lines(batch_item_id);

CREATE INDEX IF NOT EXISTS idx_accounting_deposit_match_lines_business_id
  ON accounting_deposit_match_lines(business_id, created_at DESC);

CREATE OR REPLACE FUNCTION update_accounting_deposit_match_lines_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_accounting_deposit_match_lines_updated_at ON accounting_deposit_match_lines;
CREATE TRIGGER trg_accounting_deposit_match_lines_updated_at
  BEFORE UPDATE ON accounting_deposit_match_lines
  FOR EACH ROW
  EXECUTE FUNCTION update_accounting_deposit_match_lines_updated_at();

ALTER TABLE accounting_deposit_match_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view deposit match lines for their business" ON accounting_deposit_match_lines;
CREATE POLICY "Users can view deposit match lines for their business"
  ON accounting_deposit_match_lines FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM accounting_deposits d
      JOIN business_users bu
        ON bu.business_id = d.business_id
       AND bu.user_id = auth.uid()
      WHERE d.id = accounting_deposit_match_lines.deposit_id
        AND d.business_id = accounting_deposit_match_lines.business_id
    )
  );

DROP POLICY IF EXISTS "Managers can manage deposit match lines" ON accounting_deposit_match_lines;
CREATE POLICY "Managers can manage deposit match lines"
  ON accounting_deposit_match_lines FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM accounting_deposits d
      JOIN business_users bu
        ON bu.business_id = d.business_id
       AND bu.user_id = auth.uid()
       AND bu.role IN ('owner', 'manager', 'admin')
      WHERE d.id = accounting_deposit_match_lines.deposit_id
        AND d.business_id = accounting_deposit_match_lines.business_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM accounting_deposits d
      JOIN business_users bu
        ON bu.business_id = d.business_id
       AND bu.user_id = auth.uid()
       AND bu.role IN ('owner', 'manager', 'admin')
      WHERE d.id = accounting_deposit_match_lines.deposit_id
        AND d.business_id = accounting_deposit_match_lines.business_id
    )
  );

COMMENT ON TABLE accounting_deposit_match_lines IS 'Explicit allocations that tie one deposit to batch items, carryover, cash-later deposits, or manual bank-match adjustments.';
COMMENT ON COLUMN accounting_deposit_match_lines.matched_amount IS 'The amount from this line that contributes to the bank deposit total.';
COMMENT ON COLUMN accounting_deposit_match_lines.revenue_amount IS 'Revenue portion represented by this line for display/repair workflows.';
COMMENT ON COLUMN accounting_deposit_match_lines.tax_amount IS 'Tax portion represented by this line for display/repair workflows.';
