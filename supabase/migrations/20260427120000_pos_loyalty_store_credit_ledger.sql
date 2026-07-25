-- Classify store-credit line items (deposits, refunds, disputes, etc.) for reporting and the Credits tab.

ALTER TABLE public.pos_loyalty_transactions
  ADD COLUMN IF NOT EXISTS store_credit_category text;

COMMENT ON COLUMN public.pos_loyalty_transactions.store_credit_category IS
  'For store-credit lines: deposit, dispute, refund, goodwill, promo, adjustment, other, or null for non–store-credit rows.';

-- Optional: allow new transaction_type labels used by the app (safe if no CHECK constraint exists)
DO $$ BEGIN
  -- no-op: transaction_type is typically text / unconstrained; keep migration additive only
  NULL;
END $$;
