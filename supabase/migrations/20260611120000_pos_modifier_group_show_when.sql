-- Conditional modifier groups: show a group only after a specific modifier (inventory item) is selected.
-- Used by POS register and booking portal (imported from the same modifier groups).

ALTER TABLE pos_modifier_groups
  ADD COLUMN IF NOT EXISTS show_when_inventory_id uuid REFERENCES pos_inventory(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pos_modifier_groups_show_when_inventory
  ON pos_modifier_groups(show_when_inventory_id)
  WHERE show_when_inventory_id IS NOT NULL;

COMMENT ON COLUMN pos_modifier_groups.show_when_inventory_id IS
  'When set, this modifier group is only shown after the customer/staff selects this inventory item from another group (e.g. 12" size unlocks 12" toppings).';

-- OTWK London: Cheese Pizza conditional groups
UPDATE pos_modifier_groups SET show_when_inventory_id = '0556ce17-d923-4212-b71a-9e596dfd53e2'
WHERE id = 'b84635a9-91a2-4a6b-a5b1-c0ecc28fa968';

UPDATE pos_modifier_groups SET show_when_inventory_id = '2f2d5b05-adba-4f44-96fd-420db2984222'
WHERE id IN (
  'd2e4f7d8-640a-4758-84c8-c73936eb8c18',
  '8554fed8-4942-40eb-94c4-0d001f8ed786',
  '0a79d99e-2e01-4d59-8874-b98b9e2d7f32',
  '3b9adab3-c4dd-4893-9e91-095e93672fb4'
);
