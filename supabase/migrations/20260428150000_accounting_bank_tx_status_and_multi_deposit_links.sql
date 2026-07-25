-- Support excluded bank-transaction status and allow multiple bank transactions to point at one deposit.

DROP INDEX IF EXISTS idx_accounting_bank_transactions_matched_deposit_id;

CREATE INDEX IF NOT EXISTS idx_accounting_bank_transactions_matched_deposit_id
  ON accounting_bank_transactions(matched_deposit_id)
  WHERE matched_deposit_id IS NOT NULL;

ALTER TABLE accounting_bank_transactions
  DROP CONSTRAINT IF EXISTS accounting_bank_transactions_status_check;

ALTER TABLE accounting_bank_transactions
  ADD CONSTRAINT accounting_bank_transactions_status_check
  CHECK (status IN ('pending', 'matched', 'posted', 'excluded'));
