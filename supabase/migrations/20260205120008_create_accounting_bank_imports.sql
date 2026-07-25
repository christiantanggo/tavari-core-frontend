-- Accounting MVP: bank imports and bank transactions (CSV upload)

CREATE TABLE IF NOT EXISTS accounting_bank_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounting_bank_imports_business_id ON accounting_bank_imports(business_id);
CREATE INDEX IF NOT EXISTS idx_accounting_bank_imports_imported_at ON accounting_bank_imports(business_id, imported_at DESC);

ALTER TABLE accounting_bank_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view bank imports for their business" ON accounting_bank_imports;
CREATE POLICY "Users can view bank imports for their business"
  ON accounting_bank_imports FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_bank_imports.business_id AND business_users.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Managers can manage bank imports" ON accounting_bank_imports;
CREATE POLICY "Managers can manage bank imports"
  ON accounting_bank_imports FOR ALL
  USING (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_bank_imports.business_id AND business_users.user_id = auth.uid() AND business_users.role IN ('owner', 'manager', 'admin'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_bank_imports.business_id AND business_users.user_id = auth.uid() AND business_users.role IN ('owner', 'manager', 'admin'))
  );

CREATE TABLE IF NOT EXISTS accounting_bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL REFERENCES accounting_bank_imports(id) ON DELETE CASCADE,
  transaction_date DATE NOT NULL,
  description TEXT,
  amount NUMERIC(14,2) NOT NULL,
  debit_credit TEXT NOT NULL CHECK (debit_credit IN ('debit', 'credit')),
  matched_draft_expense_id UUID REFERENCES accounting_draft_expenses(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'matched', 'posted')),
  erpnext_journal_entry_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounting_bank_transactions_import_id ON accounting_bank_transactions(import_id);
CREATE INDEX IF NOT EXISTS idx_accounting_bank_transactions_status ON accounting_bank_transactions(import_id, status);

ALTER TABLE accounting_bank_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view bank transactions for their business" ON accounting_bank_transactions;
CREATE POLICY "Users can view bank transactions for their business"
  ON accounting_bank_transactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM accounting_bank_imports bi
      JOIN business_users bu ON bu.business_id = bi.business_id AND bu.user_id = auth.uid()
      WHERE bi.id = accounting_bank_transactions.import_id
    )
  );

DROP POLICY IF EXISTS "Managers can manage bank transactions" ON accounting_bank_transactions;
CREATE POLICY "Managers can manage bank transactions"
  ON accounting_bank_transactions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM accounting_bank_imports bi
      JOIN business_users bu ON bu.business_id = bi.business_id AND bu.user_id = auth.uid() AND bu.role IN ('owner', 'manager', 'admin')
      WHERE bi.id = accounting_bank_transactions.import_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounting_bank_imports bi
      JOIN business_users bu ON bu.business_id = bi.business_id AND bu.user_id = auth.uid() AND bu.role IN ('owner', 'manager', 'admin')
      WHERE bi.id = accounting_bank_transactions.import_id
    )
  );
