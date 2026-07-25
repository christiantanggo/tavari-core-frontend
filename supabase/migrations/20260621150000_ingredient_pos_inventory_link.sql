-- Link Recipe Manager ingredients to purchasable POS inventory items
-- and attach supplier pricing to pos_inventory instead of the legacy inventory table.

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS pos_inventory_id UUID REFERENCES pos_inventory(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purchase_unit_size DECIMAL(10,4) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cost_sync_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE rb_supplier_prices
  ADD COLUMN IF NOT EXISTS pos_inventory_id UUID REFERENCES pos_inventory(id) ON DELETE CASCADE;

COMMENT ON COLUMN ingredients.pos_inventory_id IS
  'Linked POS inventory item that is purchased/stocked for this recipe ingredient';
COMMENT ON COLUMN ingredients.purchase_unit_size IS
  'How many POS inventory units are used per 1 recipe ingredient unit (default 1)';
COMMENT ON COLUMN ingredients.cost_sync_enabled IS
  'When true, ingredient cost is updated from best linked supplier price';
COMMENT ON COLUMN rb_supplier_prices.pos_inventory_id IS
  'Purchasable POS inventory item this supplier price applies to';

CREATE INDEX IF NOT EXISTS idx_ingredients_pos_inventory
  ON ingredients (pos_inventory_id)
  WHERE pos_inventory_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rb_supplier_prices_pos_inventory_current
  ON rb_supplier_prices (pos_inventory_id, supplier_id)
  WHERE is_current = true AND pos_inventory_id IS NOT NULL;
