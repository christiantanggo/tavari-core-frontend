-- Inventory bundles: combined sellable items (party packages, preset pizzas, etc.)

ALTER TABLE public.pos_inventory
  ADD COLUMN IF NOT EXISTS is_bundle boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bundle_description text,
  ADD COLUMN IF NOT EXISTS bundle_use_auto_price boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.pos_inventory.is_bundle IS
  'When true, this inventory row is a bundle managed on POS → Inventory → Bundles.';
COMMENT ON COLUMN public.pos_inventory.bundle_description IS
  'Customer-facing subtitle (ingredients, includes, etc.).';
COMMENT ON COLUMN public.pos_inventory.bundle_use_auto_price IS
  'When true, effective price is the sum of component item prices; when false, use pos_inventory.price as override.';

CREATE INDEX IF NOT EXISTS idx_pos_inventory_bundles
  ON public.pos_inventory (business_id, is_bundle)
  WHERE is_bundle = true;

CREATE TABLE IF NOT EXISTS public.pos_inventory_bundle_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  bundle_inventory_id uuid NOT NULL REFERENCES public.pos_inventory(id) ON DELETE CASCADE,
  component_inventory_id uuid NOT NULL REFERENCES public.pos_inventory(id) ON DELETE RESTRICT,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bundle_inventory_id, component_inventory_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_inventory_bundle_items_bundle
  ON public.pos_inventory_bundle_items (bundle_inventory_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_pos_inventory_bundle_items_business
  ON public.pos_inventory_bundle_items (business_id);

COMMENT ON TABLE public.pos_inventory_bundle_items IS
  'Component lines for pos_inventory rows where is_bundle = true.';
