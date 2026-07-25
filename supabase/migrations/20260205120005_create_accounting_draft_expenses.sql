-- Accounting MVP: draft expenses (from email, manual, or bank CSV)

CREATE TABLE IF NOT EXISTS accounting_draft_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('email', 'manual', 'bank_csv')),
  received_email_id UUID REFERENCES received_emails(id) ON DELETE SET NULL,
  attachment_id UUID REFERENCES received_email_attachments(id) ON DELETE SET NULL,
  vendor_id UUID REFERENCES accounting_vendors(id) ON DELETE SET NULL,
  vendor_name_display TEXT,
  transaction_date DATE,
  subtotal NUMERIC(14,2),
  tax_amount NUMERIC(14,2),
  total_amount NUMERIC(14,2) NOT NULL,
  invoice_number TEXT,
  expense_category_id UUID REFERENCES accounting_expense_categories(id) ON DELETE SET NULL,
  gl_account_erpnext TEXT,
  hst_treatment TEXT NOT NULL CHECK (hst_treatment IN ('recoverable', 'collected', 'included', 'exempt')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'posted')),
  document_hash TEXT,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  erpnext_journal_entry_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounting_draft_expenses_business_id ON accounting_draft_expenses(business_id);
CREATE INDEX IF NOT EXISTS idx_accounting_draft_expenses_status ON accounting_draft_expenses(business_id, status);
CREATE INDEX IF NOT EXISTS idx_accounting_draft_expenses_transaction_date ON accounting_draft_expenses(business_id, transaction_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_accounting_draft_expenses_received_email_id ON accounting_draft_expenses(received_email_id) WHERE received_email_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_accounting_draft_expenses_attachment_id ON accounting_draft_expenses(attachment_id) WHERE attachment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION update_accounting_draft_expenses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_accounting_draft_expenses_updated_at ON accounting_draft_expenses;
CREATE TRIGGER trg_accounting_draft_expenses_updated_at
  BEFORE UPDATE ON accounting_draft_expenses
  FOR EACH ROW
  EXECUTE FUNCTION update_accounting_draft_expenses_updated_at();

ALTER TABLE accounting_draft_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view draft expenses for their business" ON accounting_draft_expenses;
CREATE POLICY "Users can view draft expenses for their business"
  ON accounting_draft_expenses FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_draft_expenses.business_id AND business_users.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Managers can manage draft expenses" ON accounting_draft_expenses;
CREATE POLICY "Managers can manage draft expenses"
  ON accounting_draft_expenses FOR ALL
  USING (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_draft_expenses.business_id AND business_users.user_id = auth.uid() AND business_users.role IN ('owner', 'manager', 'admin'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_draft_expenses.business_id AND business_users.user_id = auth.uid() AND business_users.role IN ('owner', 'manager', 'admin'))
  );
