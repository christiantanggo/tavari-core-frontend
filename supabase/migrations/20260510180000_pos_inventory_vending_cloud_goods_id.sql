-- Vendor cloud goods_id stored on catalog rows (optional UX: filled when linking from machine inventory).

ALTER TABLE public.pos_inventory
  ADD COLUMN IF NOT EXISTS vending_cloud_goods_id TEXT;

COMMENT ON COLUMN public.pos_inventory.vending_cloud_goods_id IS
  'Manufacturer cloud goods_id (e.g. Yishouyun). Set when linking a catalog item to a slot/product from device_detail; used for vending callbacks without manual entry.';

CREATE INDEX IF NOT EXISTS idx_pos_inventory_vending_cloud_goods_id
  ON public.pos_inventory (business_id, vending_cloud_goods_id)
  WHERE vending_cloud_goods_id IS NOT NULL;

-- One-time: copy legacy junction mappings onto catalog (last write wins if duplicates).
UPDATE public.pos_inventory pi
SET vending_cloud_goods_id = vpm.manufacturer_goods_id
FROM public.vending_product_mappings vpm
WHERE pi.id = vpm.pos_inventory_id
  AND pi.business_id = vpm.business_id
  AND (pi.vending_cloud_goods_id IS NULL OR pi.vending_cloud_goods_id = vpm.manufacturer_goods_id);
