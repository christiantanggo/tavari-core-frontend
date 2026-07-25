-- Many-to-many: one ingredient can appear in multiple POS inventory items (menu products)
CREATE TABLE IF NOT EXISTS ingredient_pos_inventory_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  pos_inventory_id UUID NOT NULL REFERENCES pos_inventory(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ingredient_id, pos_inventory_id)
);

CREATE INDEX IF NOT EXISTS idx_ingredient_pos_inventory_links_business
  ON ingredient_pos_inventory_links (business_id);

CREATE INDEX IF NOT EXISTS idx_ingredient_pos_inventory_links_pos_item
  ON ingredient_pos_inventory_links (pos_inventory_id);

COMMENT ON TABLE ingredient_pos_inventory_links IS
  'Links recipe ingredients to one or more POS menu/inventory items that use them';

ALTER TABLE ingredient_pos_inventory_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY ingredient_pos_inventory_links_business_isolation
  ON ingredient_pos_inventory_links
  FOR ALL
  USING (
    business_id IN (
      SELECT business_id FROM business_users WHERE user_id = auth.uid()
    )
  );
