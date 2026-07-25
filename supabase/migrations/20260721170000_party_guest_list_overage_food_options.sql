-- Expand party guest list food/drinks preferences and support custom "Other" text.

ALTER TABLE public.party_guest_lists
  ADD COLUMN IF NOT EXISTS overage_food_other TEXT;

UPDATE public.party_guest_lists
SET overage_food = 'host_tab_food_drinks'
WHERE overage_food = 'host_tab';

ALTER TABLE public.party_guest_lists
  DROP CONSTRAINT IF EXISTS party_guest_lists_overage_food_check;

ALTER TABLE public.party_guest_lists
  ADD CONSTRAINT party_guest_lists_overage_food_check
    CHECK (overage_food IN (
      'guests_buy_own',
      'host_tab_food',
      'host_tab_drinks',
      'host_tab_food_drinks',
      'other'
    ));

COMMENT ON COLUMN public.party_guest_lists.overage_food_other IS
  'Free-text detail when overage_food is other.';

COMMENT ON COLUMN public.party_guest_lists.overage_food IS
  'Host preference for extra food/drinks beyond the package.';
