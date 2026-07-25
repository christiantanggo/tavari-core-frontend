-- Link recipe dishes to POS inventory items for the unified Recipe Manager UI
ALTER TABLE pos_modifier_groups
  ADD COLUMN IF NOT EXISTS pos_inventory_id UUID REFERENCES pos_inventory(id) ON DELETE SET NULL;

COMMENT ON COLUMN pos_modifier_groups.pos_inventory_id IS
  'POS inventory item this recipe_dish belongs to in Recipe Manager';

CREATE INDEX IF NOT EXISTS idx_pos_modifier_groups_pos_inventory
  ON pos_modifier_groups (business_id, pos_inventory_id)
  WHERE pos_inventory_id IS NOT NULL AND group_type = 'recipe_dish';
