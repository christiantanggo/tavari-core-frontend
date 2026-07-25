-- Fixed assets and monthly depreciation for P&L and CRA reconciliation.
-- RLS via business_users (same pattern as other accounting tables).

CREATE TABLE IF NOT EXISTS accounting_fixed_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  cost NUMERIC(14,2) NOT NULL CHECK (cost >= 0),
  salvage_value NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0),
  service_date DATE NOT NULL,
  useful_life_months INTEGER NOT NULL CHECK (useful_life_months > 0),
  gl_asset_account_erpnext TEXT,
  gl_depreciation_expense_account_erpnext TEXT,
  gl_accumulated_depreciation_account_erpnext TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disposed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounting_fixed_assets_business_id ON accounting_fixed_assets(business_id);
CREATE INDEX IF NOT EXISTS idx_accounting_fixed_assets_service_date ON accounting_fixed_assets(business_id, service_date);
CREATE INDEX IF NOT EXISTS idx_accounting_fixed_assets_status ON accounting_fixed_assets(business_id, status);

CREATE OR REPLACE FUNCTION update_accounting_fixed_assets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_accounting_fixed_assets_updated_at ON accounting_fixed_assets;
CREATE TRIGGER trg_accounting_fixed_assets_updated_at
  BEFORE UPDATE ON accounting_fixed_assets
  FOR EACH ROW
  EXECUTE FUNCTION update_accounting_fixed_assets_updated_at();

ALTER TABLE accounting_fixed_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view fixed assets for their business" ON accounting_fixed_assets;
CREATE POLICY "Users can view fixed assets for their business"
  ON accounting_fixed_assets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = accounting_fixed_assets.business_id
      AND business_users.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Managers can manage fixed assets" ON accounting_fixed_assets;
CREATE POLICY "Managers can manage fixed assets"
  ON accounting_fixed_assets FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = accounting_fixed_assets.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = accounting_fixed_assets.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin')
    )
  );

-- Tracks each month's depreciation posted so we don't double-post.
CREATE TABLE IF NOT EXISTS accounting_depreciation_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES accounting_fixed_assets(id) ON DELETE CASCADE,
  period_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  erpnext_journal_entry_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(asset_id, period_date)
);

CREATE INDEX IF NOT EXISTS idx_accounting_depreciation_entries_business_id ON accounting_depreciation_entries(business_id);
CREATE INDEX IF NOT EXISTS idx_accounting_depreciation_entries_asset_id ON accounting_depreciation_entries(asset_id);
CREATE INDEX IF NOT EXISTS idx_accounting_depreciation_entries_period ON accounting_depreciation_entries(business_id, period_date);

ALTER TABLE accounting_depreciation_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view depreciation entries for their business" ON accounting_depreciation_entries;
CREATE POLICY "Users can view depreciation entries for their business"
  ON accounting_depreciation_entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = accounting_depreciation_entries.business_id
      AND business_users.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Managers can insert depreciation entries" ON accounting_depreciation_entries;
CREATE POLICY "Managers can insert depreciation entries"
  ON accounting_depreciation_entries FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = accounting_depreciation_entries.business_id
      AND business_users.user_id = auth.uid()
      AND business_users.role IN ('owner', 'manager', 'admin')
    )
  );
