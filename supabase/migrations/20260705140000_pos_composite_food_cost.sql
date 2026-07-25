-- Composite food cost: modifier cost multipliers + persisted line cost on sales

ALTER TABLE pos_modifier_group_items
  ADD COLUMN IF NOT EXISTS cost_multiplier DECIMAL(10,4) NOT NULL DEFAULT 1;

COMMENT ON COLUMN pos_modifier_group_items.cost_multiplier IS
  'Scales additive modifier food cost (e.g. 20oz drink = 1.67× syrup cost). Customer price uses price_override.';

ALTER TABLE pos_sale_items
  ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(10,4),
  ADD COLUMN IF NOT EXISTS food_cost_total DECIMAL(10,4);

COMMENT ON COLUMN pos_sale_items.unit_cost IS
  'Composite food cost per unit: parent base cost + scaled modifier costs at time of sale';
COMMENT ON COLUMN pos_sale_items.food_cost_total IS
  'unit_cost × quantity';

CREATE INDEX IF NOT EXISTS idx_pos_sale_items_unit_cost
  ON pos_sale_items (business_id, sale_id)
  WHERE unit_cost IS NOT NULL;
