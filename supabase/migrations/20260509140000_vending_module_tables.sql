-- Tavari Vending: devices, kiosk auth, goods→POS inventory mapping, idempotent order tracking

INSERT INTO public.app_modules (module_key, module_name, description, icon, enabled_by_default, module_category)
VALUES (
  'vending',
  'Tavari Vending',
  'Connect vending hardware to Tavari POS inventory and sales',
  'FiPackage',
  false,
  'Sales'
)
ON CONFLICT (module_key) DO UPDATE SET
  module_name = EXCLUDED.module_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  module_category = EXCLUDED.module_category;

CREATE TABLE IF NOT EXISTS public.vending_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  external_device_id TEXT NOT NULL,
  display_name TEXT,
  kiosk_secret_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, external_device_id)
);

CREATE TABLE IF NOT EXISTS public.vending_product_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  vending_device_id UUID NOT NULL REFERENCES public.vending_devices(id) ON DELETE CASCADE,
  manufacturer_goods_id TEXT NOT NULL,
  pos_inventory_id UUID NOT NULL REFERENCES public.pos_inventory(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vending_device_id, manufacturer_goods_id)
);

CREATE INDEX IF NOT EXISTS idx_vending_devices_business ON public.vending_devices (business_id);
CREATE INDEX IF NOT EXISTS idx_vending_mappings_business ON public.vending_product_mappings (business_id);
CREATE INDEX IF NOT EXISTS idx_vending_mappings_device ON public.vending_product_mappings (vending_device_id);

CREATE TABLE IF NOT EXISTS public.vending_processed_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  external_order_no TEXT NOT NULL,
  pos_sale_id UUID REFERENCES public.pos_sales(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, external_order_no)
);

CREATE INDEX IF NOT EXISTS idx_vending_processed_orders_business ON public.vending_processed_orders (business_id);

ALTER TABLE public.vending_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vending_product_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vending_processed_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vending_devices_business_users_all ON public.vending_devices;
CREATE POLICY vending_devices_business_users_all
  ON public.vending_devices
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = vending_devices.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.business_id = vending_devices.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = vending_devices.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.business_id = vending_devices.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
    )
  );

DROP POLICY IF EXISTS vending_product_mappings_business_users_all ON public.vending_product_mappings;
CREATE POLICY vending_product_mappings_business_users_all
  ON public.vending_product_mappings
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = vending_product_mappings.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.business_id = vending_product_mappings.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = vending_product_mappings.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.business_id = vending_product_mappings.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
    )
  );

DROP POLICY IF EXISTS vending_processed_orders_no_client ON public.vending_processed_orders;
CREATE POLICY vending_processed_orders_no_client
  ON public.vending_processed_orders
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.vending_devices IS 'Per-business vending machine registrations (manufacturer device id + kiosk secret hash).';
COMMENT ON TABLE public.vending_product_mappings IS 'Maps manufacturer goods_id to pos_inventory row per device.';
COMMENT ON TABLE public.vending_processed_orders IS 'Idempotency log for vending sales (written by Edge Function service role only).';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vending_devices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vending_product_mappings TO authenticated;
