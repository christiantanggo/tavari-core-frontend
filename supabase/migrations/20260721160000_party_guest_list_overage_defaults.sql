-- Default extra-guest responsibility to guests unless the host overrides.

ALTER TABLE public.party_guest_lists
  ALTER COLUMN overage_payment SET DEFAULT 'guest_at_gate';

ALTER TABLE public.party_guest_lists
  ALTER COLUMN overage_food SET DEFAULT 'guests_buy_own';

UPDATE public.party_guest_lists
SET overage_payment = 'guest_at_gate'
WHERE overage_payment IS NULL;

UPDATE public.party_guest_lists
SET overage_food = 'guests_buy_own'
WHERE overage_food IS NULL;
