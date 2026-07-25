-- Extend existing pos_categories table for Recipe Builder
-- This follows the optimized build plan to reuse existing tables

-- Add recipe support to existing pos_categories table
ALTER TABLE pos_categories ADD COLUMN IF NOT EXISTS category_type VARCHAR(20) DEFAULT 'both';

-- Create index for category type filtering
CREATE INDEX IF NOT EXISTS idx_pos_categories_recipe_type ON pos_categories(category_type, business_id);

-- Add comment for documentation
COMMENT ON COLUMN pos_categories.category_type IS 'Category type: pos_only, recipe_only, or both';

-- Insert default recipe categories
INSERT INTO pos_categories (name, color, emoji, business_id, category_type) 
SELECT 
  'Proteins', '#ff6b6b', '🥩', id, 'recipe_only'
FROM businesses 
WHERE NOT EXISTS (
  SELECT 1 FROM pos_categories 
  WHERE name = 'Proteins' AND business_id = businesses.id
);

INSERT INTO pos_categories (name, color, emoji, business_id, category_type) 
SELECT 
  'Vegetables', '#4ecdc4', '🥕', id, 'recipe_only'
FROM businesses 
WHERE NOT EXISTS (
  SELECT 1 FROM pos_categories 
  WHERE name = 'Vegetables' AND business_id = businesses.id
);

INSERT INTO pos_categories (name, color, emoji, business_id, category_type) 
SELECT 
  'Dairy', '#45b7d1', '🥛', id, 'recipe_only'
FROM businesses 
WHERE NOT EXISTS (
  SELECT 1 FROM pos_categories 
  WHERE name = 'Dairy' AND business_id = businesses.id
);

INSERT INTO pos_categories (name, color, emoji, business_id, category_type) 
SELECT 
  'Spices', '#96ceb4', '🌿', id, 'recipe_only'
FROM businesses 
WHERE NOT EXISTS (
  SELECT 1 FROM pos_categories 
  WHERE name = 'Spices' AND business_id = businesses.id
);

INSERT INTO pos_categories (name, color, emoji, business_id, category_type) 
SELECT 
  'Grains', '#feca57', '🌾', id, 'recipe_only'
FROM businesses 
WHERE NOT EXISTS (
  SELECT 1 FROM pos_categories 
  WHERE name = 'Grains' AND business_id = businesses.id
);

