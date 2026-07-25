-- Gift card tender metadata for online booking Helcim checkout sessions.

ALTER TABLE public.booking_pending_helcim
  ADD COLUMN IF NOT EXISTS gift_card_id UUID,
  ADD COLUMN IF NOT EXISTS gift_card_code TEXT,
  ADD COLUMN IF NOT EXISTS gift_card_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.booking_pending_helcim.gift_card_id IS
  'Gift card applied at portal checkout (redeemed on finalize).';
COMMENT ON COLUMN public.booking_pending_helcim.gift_card_code IS
  'Gift card code snapshot at checkout init.';
COMMENT ON COLUMN public.booking_pending_helcim.gift_card_amount IS
  'Amount to redeem from the gift card toward chargeNow (deposit or full).';

ALTER TABLE public.booking_payments
  ADD COLUMN IF NOT EXISTS gift_card_id UUID,
  ADD COLUMN IF NOT EXISTS gift_card_code TEXT;

COMMENT ON COLUMN public.booking_payments.gift_card_id IS
  'Gift card used for this payment row when payment_method is gift_card.';
COMMENT ON COLUMN public.booking_payments.gift_card_code IS
  'Gift card code snapshot for staff/receipt display.';
