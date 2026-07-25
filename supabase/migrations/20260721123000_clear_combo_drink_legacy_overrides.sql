-- Clear legacy Combo Drink free/override pricing.
-- Meals now use pos_inventory.included_modifier_category_id + included_modifier_max_price.
UPDATE public.pos_modifier_group_items
SET
  is_free = false,
  price_override = null,
  updated_at = now()
WHERE modifier_group_id = '8164feca-9461-4711-b34e-7c9e25b6be42'
  AND (is_free = true OR price_override IS NOT NULL);
