-- Persist slot programming in Tavari when vendor device_detail returns no inventory array.

CREATE TABLE IF NOT EXISTS public.vending_device_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  vending_device_id UUID NOT NULL REFERENCES public.vending_devices(id) ON DELETE CASCADE,
  sev_no TEXT NOT NULL DEFAULT '1',
  row_num INTEGER NOT NULL,
  col_num INTEGER NOT NULL,
  manufacturer_goods_id TEXT NOT NULL,
  pos_inventory_id UUID REFERENCES public.pos_inventory(id) ON DELETE SET NULL,
  num INTEGER NOT NULL DEFAULT 0,
  max_num INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vending_device_id, sev_no, row_num, col_num)
);

CREATE INDEX IF NOT EXISTS idx_vending_device_slots_business
  ON public.vending_device_slots (business_id);

CREATE INDEX IF NOT EXISTS idx_vending_device_slots_device
  ON public.vending_device_slots (vending_device_id);

CREATE INDEX IF NOT EXISTS idx_vending_device_slots_goods
  ON public.vending_device_slots (vending_device_id, manufacturer_goods_id);

ALTER TABLE public.vending_device_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vending_device_slots_business_users_all ON public.vending_device_slots;
CREATE POLICY vending_device_slots_business_users_all
  ON public.vending_device_slots
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = vending_device_slots.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.business_id = vending_device_slots.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = vending_device_slots.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.business_id = vending_device_slots.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
    )
  );

COMMENT ON TABLE public.vending_device_slots IS
  'Tavari mirror of vendor slot programming (save_stock). Used when device_detail omits inventory.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vending_device_slots TO authenticated;
