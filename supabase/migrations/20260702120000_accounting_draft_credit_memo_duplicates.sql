-- Credit memo document type + duplicate detection for expense drafts

ALTER TABLE accounting_draft_expenses
  ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL DEFAULT 'invoice'
    CHECK (document_type IN ('invoice', 'credit_memo')),
  ADD COLUMN IF NOT EXISTS credit_memo_against TEXT,
  ADD COLUMN IF NOT EXISTS is_duplicate BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS duplicate_of_draft_id UUID REFERENCES accounting_draft_expenses(id) ON DELETE SET NULL;

COMMENT ON COLUMN accounting_draft_expenses.document_type IS 'invoice = vendor bill; credit_memo = vendor credit (posted as ERPNext Purchase Invoice is_return).';
COMMENT ON COLUMN accounting_draft_expenses.credit_memo_against IS 'Original vendor invoice number this credit memo applies to, when known.';
COMMENT ON COLUMN accounting_draft_expenses.is_duplicate IS 'True when another draft or posted expense matches vendor + invoice number.';
COMMENT ON COLUMN accounting_draft_expenses.duplicate_of_draft_id IS 'Earlier matching expense draft or posted record.';

CREATE INDEX IF NOT EXISTS idx_accounting_draft_expenses_invoice_dup
  ON accounting_draft_expenses (business_id, lower(trim(invoice_number)))
  WHERE invoice_number IS NOT NULL AND trim(invoice_number) <> '';
