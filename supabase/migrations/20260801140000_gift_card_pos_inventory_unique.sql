-- Prevent duplicate POS inventory rows for the same gift card product

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_inventory_gift_card_product_unique
  ON public.pos_inventory (business_id, gift_card_product_id)
  WHERE gift_card_product_id IS NOT NULL;
