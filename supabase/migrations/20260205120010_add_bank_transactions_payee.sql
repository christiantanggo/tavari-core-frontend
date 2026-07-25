-- Add payee (company/person name) to bank transactions - from CSV "sub description" column

ALTER TABLE accounting_bank_transactions
  ADD COLUMN IF NOT EXISTS payee TEXT;

COMMENT ON COLUMN accounting_bank_transactions.payee IS 'Company or person name from bank CSV (e.g. sub description column)';
