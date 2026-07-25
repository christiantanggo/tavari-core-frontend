-- Foreign invoice currency + CAD amount actually charged on card/bank

ALTER TABLE accounting_draft_expenses
  ADD COLUMN IF NOT EXISTS invoice_currency TEXT NOT NULL DEFAULT 'CAD',
  ADD COLUMN IF NOT EXISTS cad_settlement_total NUMERIC(14,2);

COMMENT ON COLUMN accounting_draft_expenses.invoice_currency IS 'ISO 4217 currency on the supplier invoice (e.g. USD). Amounts in subtotal/tax/total are in this currency unless cad_settlement_total is set.';
COMMENT ON COLUMN accounting_draft_expenses.cad_settlement_total IS 'Actual CAD charged on the Canadian bank/card. When set, posting and bank matching use this instead of total_amount.';
