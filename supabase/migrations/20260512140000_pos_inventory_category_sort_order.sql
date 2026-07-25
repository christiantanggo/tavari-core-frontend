-- Per-category display order for POS inventory (register, kiosk, dining grid).

ALTER TABLE public.pos_inventory
  ADD COLUMN IF NOT EXISTS category_sort_order integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.pos_inventory.category_sort_order IS
  'Sort rank among items sharing the same category_id for a business; lower appears first. Meaningful when category_id is set.';

CREATE INDEX IF NOT EXISTS idx_pos_inventory_business_category_sort
  ON public.pos_inventory (business_id, category_id, category_sort_order)
  WHERE category_id IS NOT NULL;
