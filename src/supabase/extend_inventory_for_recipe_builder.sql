-- Extend existing inventory table for Recipe Builder
-- This follows the optimized build plan to reuse existing tables

-- Add ingredient support columns to existing inventory table
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS unit_of_measure VARCHAR(50);
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS allergens TEXT[];
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS storage_requirements TEXT;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS ingredient_type VARCHAR(20) DEFAULT 'ingredient';

-- Add constraint for ingredient validation (more flexible)
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS check_ingredient_unit_of_measure;
ALTER TABLE inventory ADD CONSTRAINT check_ingredient_unit_of_measure 
  CHECK (ingredient_type IS NULL OR ingredient_type != 'ingredient' OR unit_of_measure IS NOT NULL);

-- Create index for ingredient type filtering
CREATE INDEX IF NOT EXISTS idx_inventory_ingredient_type ON inventory(ingredient_type, business_id);
CREATE INDEX IF NOT EXISTS idx_inventory_cost_tracking ON inventory(business_id, cost, updated_at);

-- Add comments for documentation
COMMENT ON COLUMN inventory.unit_of_measure IS 'Unit of measure for ingredients (cups, lbs, oz, etc.)';
COMMENT ON COLUMN inventory.allergens IS 'Array of allergens present in this ingredient';
COMMENT ON COLUMN inventory.shelf_life_days IS 'Shelf life in days for perishable ingredients';
COMMENT ON COLUMN inventory.storage_requirements IS 'Storage requirements (refrigerated, frozen, room temp)';
COMMENT ON COLUMN inventory.ingredient_type IS 'Type: ingredient, product, or both';
