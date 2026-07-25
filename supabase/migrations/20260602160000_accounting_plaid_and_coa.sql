-- Plaid bank feed foundation + bank tx external id for dedup

ALTER TABLE accounting_bank_imports
  ADD COLUMN IF NOT EXISTS import_source TEXT NOT NULL DEFAULT 'csv';

ALTER TABLE accounting_bank_imports
  DROP CONSTRAINT IF EXISTS accounting_bank_imports_import_source_check;

ALTER TABLE accounting_bank_imports
  ADD CONSTRAINT accounting_bank_imports_import_source_check
  CHECK (import_source IN ('csv', 'plaid'));

COMMENT ON COLUMN accounting_bank_imports.import_source IS 'csv = manual upload; plaid = live bank sync';

ALTER TABLE accounting_bank_transactions
  ADD COLUMN IF NOT EXISTS external_transaction_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_bank_tx_external_id
  ON accounting_bank_transactions (external_transaction_id)
  WHERE external_transaction_id IS NOT NULL;

COMMENT ON COLUMN accounting_bank_transactions.external_transaction_id IS 'Plaid transaction_id (or other feed) for idempotent imports';

CREATE TABLE IF NOT EXISTS accounting_plaid_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  institution_name TEXT,
  institution_id TEXT,
  sync_cursor TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_accounting_plaid_items_business
  ON accounting_plaid_items (business_id);

CREATE TABLE IF NOT EXISTS accounting_plaid_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  plaid_item_id UUID NOT NULL REFERENCES accounting_plaid_items(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  name TEXT,
  mask TEXT,
  account_type TEXT,
  account_subtype TEXT,
  bank_account_erpnext TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plaid_item_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_accounting_plaid_accounts_business
  ON accounting_plaid_accounts (business_id);

ALTER TABLE accounting_plaid_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_plaid_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers view plaid items" ON accounting_plaid_items;
CREATE POLICY "Managers view plaid items"
  ON accounting_plaid_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = accounting_plaid_items.business_id
        AND business_users.user_id = auth.uid()
        AND business_users.role IN ('owner', 'manager', 'admin')
    )
  );

DROP POLICY IF EXISTS "Managers manage plaid items" ON accounting_plaid_items;
CREATE POLICY "Managers manage plaid items"
  ON accounting_plaid_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = accounting_plaid_items.business_id
        AND business_users.user_id = auth.uid()
        AND business_users.role IN ('owner', 'manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = accounting_plaid_items.business_id
        AND business_users.user_id = auth.uid()
        AND business_users.role IN ('owner', 'manager', 'admin')
    )
  );

DROP POLICY IF EXISTS "Managers view plaid accounts" ON accounting_plaid_accounts;
CREATE POLICY "Managers view plaid accounts"
  ON accounting_plaid_accounts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = accounting_plaid_accounts.business_id
        AND business_users.user_id = auth.uid()
        AND business_users.role IN ('owner', 'manager', 'admin')
    )
  );

DROP POLICY IF EXISTS "Managers manage plaid accounts" ON accounting_plaid_accounts;
CREATE POLICY "Managers manage plaid accounts"
  ON accounting_plaid_accounts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = accounting_plaid_accounts.business_id
        AND business_users.user_id = auth.uid()
        AND business_users.role IN ('owner', 'manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = accounting_plaid_accounts.business_id
        AND business_users.user_id = auth.uid()
        AND business_users.role IN ('owner', 'manager', 'admin')
    )
  );
