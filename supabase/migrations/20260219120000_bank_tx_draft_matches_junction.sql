-- Many-to-many: multiple draft expenses (invoices/credits) can match one bank transaction.
CREATE TABLE IF NOT EXISTS accounting_bank_transaction_draft_matches (
  bank_transaction_id UUID NOT NULL REFERENCES accounting_bank_transactions(id) ON DELETE CASCADE,
  draft_expense_id UUID NOT NULL REFERENCES accounting_draft_expenses(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bank_transaction_id, draft_expense_id)
);

CREATE INDEX IF NOT EXISTS idx_bank_tx_draft_matches_draft ON accounting_bank_transaction_draft_matches(draft_expense_id);
CREATE INDEX IF NOT EXISTS idx_bank_tx_draft_matches_tx ON accounting_bank_transaction_draft_matches(bank_transaction_id);

COMMENT ON TABLE accounting_bank_transaction_draft_matches IS 'Links multiple draft expenses (invoices/credits) to one bank payment.';

ALTER TABLE accounting_bank_transaction_draft_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view bank tx draft matches for their business" ON accounting_bank_transaction_draft_matches;
CREATE POLICY "Users can view bank tx draft matches for their business"
  ON accounting_bank_transaction_draft_matches FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM accounting_bank_transactions t
      JOIN accounting_bank_imports bi ON bi.id = t.import_id
      JOIN business_users bu ON bu.business_id = bi.business_id AND bu.user_id = auth.uid()
      WHERE t.id = accounting_bank_transaction_draft_matches.bank_transaction_id
    )
  );

DROP POLICY IF EXISTS "Managers can manage bank tx draft matches" ON accounting_bank_transaction_draft_matches;
CREATE POLICY "Managers can manage bank tx draft matches"
  ON accounting_bank_transaction_draft_matches FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM accounting_bank_transactions t
      JOIN accounting_bank_imports bi ON bi.id = t.import_id
      JOIN business_users bu ON bu.business_id = bi.business_id AND bu.user_id = auth.uid() AND bu.role IN ('owner', 'manager', 'admin')
      WHERE t.id = accounting_bank_transaction_draft_matches.bank_transaction_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounting_bank_transactions t
      JOIN accounting_bank_imports bi ON bi.id = t.import_id
      JOIN business_users bu ON bu.business_id = bi.business_id AND bu.user_id = auth.uid() AND bu.role IN ('owner', 'manager', 'admin')
      WHERE t.id = accounting_bank_transaction_draft_matches.bank_transaction_id
    )
  );

-- Backfill: existing single matches become junction rows
INSERT INTO accounting_bank_transaction_draft_matches (bank_transaction_id, draft_expense_id)
  SELECT id, matched_draft_expense_id
  FROM accounting_bank_transactions
  WHERE matched_draft_expense_id IS NOT NULL
  ON CONFLICT (bank_transaction_id, draft_expense_id) DO NOTHING;
