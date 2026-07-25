-- Vendor matching rules, multi-line expense drafts, Purchase Invoice linkage

CREATE TABLE IF NOT EXISTS accounting_vendor_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  match_pattern TEXT NOT NULL,
  vendor_id UUID REFERENCES accounting_vendors(id) ON DELETE SET NULL,
  expense_category_id UUID REFERENCES accounting_expense_categories(id) ON DELETE SET NULL,
  gl_account_erpnext TEXT,
  hst_treatment TEXT CHECK (hst_treatment IS NULL OR hst_treatment IN ('recoverable', 'collected', 'included', 'exempt')),
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounting_vendor_rules_business ON accounting_vendor_rules(business_id, priority DESC);

CREATE TABLE IF NOT EXISTS accounting_draft_expense_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_expense_id UUID NOT NULL REFERENCES accounting_draft_expenses(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  description TEXT,
  amount NUMERIC(14,2) NOT NULL,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  expense_category_id UUID REFERENCES accounting_expense_categories(id) ON DELETE SET NULL,
  gl_account_erpnext TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounting_draft_expense_lines_draft ON accounting_draft_expense_lines(draft_expense_id, sort_order);

ALTER TABLE accounting_draft_expenses
  ADD COLUMN IF NOT EXISTS erpnext_purchase_invoice_id TEXT,
  ADD COLUMN IF NOT EXISTS erpnext_payment_entry_id TEXT;

COMMENT ON COLUMN accounting_draft_expenses.erpnext_purchase_invoice_id IS 'Submitted ERPNext Purchase Invoice for AP-aligned expense posting.';
COMMENT ON COLUMN accounting_draft_expenses.erpnext_payment_entry_id IS 'ERPNext Payment Entry when expense was paid directly from bank import.';

ALTER TABLE accounting_vendor_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_draft_expense_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view vendor rules for their business" ON accounting_vendor_rules;
CREATE POLICY "Users can view vendor rules for their business"
  ON accounting_vendor_rules FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_vendor_rules.business_id AND business_users.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Managers can manage vendor rules" ON accounting_vendor_rules;
CREATE POLICY "Managers can manage vendor rules"
  ON accounting_vendor_rules FOR ALL
  USING (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_vendor_rules.business_id AND business_users.user_id = auth.uid() AND business_users.role IN ('owner', 'manager', 'admin'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_vendor_rules.business_id AND business_users.user_id = auth.uid() AND business_users.role IN ('owner', 'manager', 'admin'))
  );

DROP POLICY IF EXISTS "Users can view draft expense lines for their business" ON accounting_draft_expense_lines;
CREATE POLICY "Users can view draft expense lines for their business"
  ON accounting_draft_expense_lines FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_draft_expense_lines.business_id AND business_users.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Managers can manage draft expense lines" ON accounting_draft_expense_lines;
CREATE POLICY "Managers can manage draft expense lines"
  ON accounting_draft_expense_lines FOR ALL
  USING (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_draft_expense_lines.business_id AND business_users.user_id = auth.uid() AND business_users.role IN ('owner', 'manager', 'admin'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM business_users WHERE business_users.business_id = accounting_draft_expense_lines.business_id AND business_users.user_id = auth.uid() AND business_users.role IN ('owner', 'manager', 'admin'))
  );
