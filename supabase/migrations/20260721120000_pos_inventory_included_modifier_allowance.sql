-- Combo/meal included modifier allowance (before tax).
-- When set, modifiers whose inventory is in this category charge
-- max(0, inventory_price - included_modifier_max_price) instead of full price.
ALTER TABLE public.pos_inventory
  ADD COLUMN IF NOT EXISTS included_modifier_category_id uuid
    REFERENCES public.pos_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS included_modifier_max_price numeric(10, 2);

COMMENT ON COLUMN public.pos_inventory.included_modifier_category_id IS
  'Category of modifiers eligible for included allowance (e.g. Drinks on a meal).';
COMMENT ON COLUMN public.pos_inventory.included_modifier_max_price IS
  'Max before-tax inventory price included with this product; overage is the upgrade charge.';

CREATE INDEX IF NOT EXISTS idx_pos_inventory_included_modifier_category
  ON public.pos_inventory (included_modifier_category_id)
  WHERE included_modifier_category_id IS NOT NULL;
