-- Supplier product URLs and prices keyed per recipe ingredient (not per POS menu item)

ALTER TABLE rb_supplier_prices
  ADD COLUMN IF NOT EXISTS ingredient_id UUID REFERENCES ingredients(id) ON DELETE CASCADE;

COMMENT ON COLUMN rb_supplier_prices.ingredient_id IS
  'Recipe ingredient this supplier URL/price applies to';

CREATE INDEX IF NOT EXISTS idx_rb_supplier_prices_ingredient_current
  ON rb_supplier_prices (ingredient_id, supplier_id)
  WHERE is_current = true AND ingredient_id IS NOT NULL;
