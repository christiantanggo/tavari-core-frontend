-- Fountain/syrup unit costs need more than 2 decimal places (e.g. $59.44 case ÷ 2560 oz ≈ $0.0232).
-- numeric(10,2) was rounding small per-unit costs to $0.00 and breaking recipe totals.

ALTER TABLE ingredients
  ALTER COLUMN cost TYPE DECIMAL(12, 6);

ALTER TABLE pos_inventory
  ALTER COLUMN cost TYPE DECIMAL(12, 6);

COMMENT ON COLUMN ingredients.cost IS 'Per recipe-unit food cost; 6 decimal places for small pour/syrup units';
COMMENT ON COLUMN pos_inventory.cost IS 'Synced recipe food cost; 6 decimal places for small pour/syrup units';
