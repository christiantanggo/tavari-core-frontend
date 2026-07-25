-- Allow store-credit (and related loyalty adjustment) transaction types on pos_loyalty_transactions.
-- Prior CHECK only allowed: earn, spend, redeem, adjust, expire — which blocked store credit deposits.

ALTER TABLE public.pos_loyalty_transactions
  DROP CONSTRAINT IF EXISTS pos_loyalty_transactions_transaction_type_check;

ALTER TABLE public.pos_loyalty_transactions
  ADD CONSTRAINT pos_loyalty_transactions_transaction_type_check
  CHECK (
    (transaction_type)::text = ANY (
      ARRAY[
        'earn'::text,
        'spend'::text,
        'redeem'::text,
        'adjust'::text,
        'expire'::text,
        'manual_add'::text,
        'manual_subtract'::text,
        'initial_balance'::text,
        'store_credit'::text,
        'store_credit_reversal'::text
      ]
    )
  );

COMMENT ON CONSTRAINT pos_loyalty_transactions_transaction_type_check ON public.pos_loyalty_transactions IS
  'Allowed loyalty ledger types including store_credit / store_credit_reversal for account money.';
