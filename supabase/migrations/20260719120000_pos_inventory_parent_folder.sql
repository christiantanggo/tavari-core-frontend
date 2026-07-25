-- Register product folders: child items nest under a parent tile (e.g. Bubly → flavours).
ALTER TABLE public.pos_inventory
  ADD COLUMN IF NOT EXISTS parent_inventory_id uuid NULL
    REFERENCES public.pos_inventory(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.pos_inventory.parent_inventory_id IS
  'When set, this item is hidden from the root POS grid and shown inside the parent folder picker.';

CREATE INDEX IF NOT EXISTS idx_pos_inventory_parent_folder
  ON public.pos_inventory (business_id, parent_inventory_id)
  WHERE parent_inventory_id IS NOT NULL;
