-- Bank reconciliation: mark transactions as cleared when reconciled with statement.

ALTER TABLE accounting_bank_transactions
  ADD COLUMN IF NOT EXISTS reconciled_at DATE;

COMMENT ON COLUMN accounting_bank_transactions.reconciled_at IS 'Date this transaction was marked cleared/reconciled (bank rec).';
