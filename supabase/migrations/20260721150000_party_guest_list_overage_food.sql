-- Party guest list: host choice for additional food beyond the package

ALTER TABLE public.party_guest_lists
  ADD COLUMN IF NOT EXISTS overage_food TEXT
    CHECK (overage_food IN ('guests_buy_own', 'host_tab'));

COMMENT ON COLUMN public.party_guest_lists.overage_food IS
  'Host preference for extra food: guests buy their own, or host runs a tab for party guests.';
