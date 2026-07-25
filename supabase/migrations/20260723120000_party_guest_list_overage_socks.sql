-- Party guest list: host choice for covering socks when guests forget them
-- Values mirror admission-style codes already used in production:
--   guests_buy_own | host_bill

ALTER TABLE public.party_guest_lists
  ADD COLUMN IF NOT EXISTS overage_socks TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'party_guest_lists_overage_socks_check'
  ) THEN
    ALTER TABLE public.party_guest_lists
      ADD CONSTRAINT party_guest_lists_overage_socks_check
      CHECK (overage_socks IS NULL OR overage_socks IN ('guests_buy_own', 'host_bill'));
  END IF;
END $$;

ALTER TABLE public.party_guest_lists
  ALTER COLUMN overage_socks SET DEFAULT 'guests_buy_own';

UPDATE public.party_guest_lists
SET overage_socks = 'guests_buy_own'
WHERE overage_socks IS NULL
   OR overage_socks IN ('guest_buys', 'host_covers');

COMMENT ON COLUMN public.party_guest_lists.overage_socks IS
  'Host preference for forgotten socks: guests_buy_own or host_bill.';
