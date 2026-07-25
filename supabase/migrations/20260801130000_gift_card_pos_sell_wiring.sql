-- Gift card POS sell wiring: personal message + inventory flags

ALTER TABLE public.gift_cards
  ADD COLUMN IF NOT EXISTS personal_message TEXT;

ALTER TABLE public.pos_inventory
  ADD COLUMN IF NOT EXISTS is_gift_card BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gift_card_product_id UUID;

CREATE INDEX IF NOT EXISTS idx_pos_inventory_gift_card_product
  ON public.pos_inventory (business_id, gift_card_product_id)
  WHERE gift_card_product_id IS NOT NULL;
