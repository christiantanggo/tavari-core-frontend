-- Extend existing pos_modifier_groups table for Recipe Builder
-- This follows the optimized build plan to reuse existing tables

-- Add recipe functionality to existing pos_modifier_groups table
ALTER TABLE pos_modifier_groups ADD COLUMN IF NOT EXISTS group_type VARCHAR(20) DEFAULT 'modifier';
ALTER TABLE pos_modifier_groups ADD COLUMN IF NOT EXISTS serving_size DECIMAL(8,2);
ALTER TABLE pos_modifier_groups ADD COLUMN IF NOT EXISTS prep_time_minutes INTEGER;
ALTER TABLE pos_modifier_groups ADD COLUMN IF NOT EXISTS requires_heating BOOLEAN DEFAULT false;
ALTER TABLE pos_modifier_groups ADD COLUMN IF NOT EXISTS requires_cooling BOOLEAN DEFAULT false;
ALTER TABLE pos_modifier_groups ADD COLUMN IF NOT EXISTS labor_intensive BOOLEAN DEFAULT false;
ALTER TABLE pos_modifier_groups ADD COLUMN IF NOT EXISTS target_margin_percent DECIMAL(5,2);

-- Add recipe ingredient details to existing pos_modifier_group_items table
ALTER TABLE pos_modifier_group_items ADD COLUMN IF NOT EXISTS unit_of_measure VARCHAR(50);
ALTER TABLE pos_modifier_group_items ADD COLUMN IF NOT EXISTS prep_notes TEXT;

-- Create indexes for recipe type filtering
CREATE INDEX IF NOT EXISTS idx_pos_modifier_groups_recipe_type ON pos_modifier_groups(group_type, business_id);

-- Add comments for documentation
COMMENT ON COLUMN pos_modifier_groups.group_type IS 'Type: modifier, recipe_dish, or recipe_batch';
COMMENT ON COLUMN pos_modifier_groups.serving_size IS 'Number of servings this recipe makes';
COMMENT ON COLUMN pos_modifier_groups.prep_time_minutes IS 'Preparation time in minutes';
COMMENT ON COLUMN pos_modifier_groups.requires_heating IS 'Whether recipe requires heating/cooking';
COMMENT ON COLUMN pos_modifier_groups.requires_cooling IS 'Whether recipe requires refrigeration';
COMMENT ON COLUMN pos_modifier_groups.labor_intensive IS 'Whether recipe is labor intensive';
COMMENT ON COLUMN pos_modifier_groups.target_margin_percent IS 'Target profit margin percentage';
COMMENT ON COLUMN pos_modifier_group_items.unit_of_measure IS 'Unit of measure for this ingredient in the recipe';
COMMENT ON COLUMN pos_modifier_group_items.prep_notes IS 'Preparation notes for this ingredient';

