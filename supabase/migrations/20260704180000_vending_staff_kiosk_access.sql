-- Staff-only kiosk mode: PIN required instead of payment, with dispense audit log.

ALTER TABLE public.vending_devices
  ADD COLUMN IF NOT EXISTS kiosk_access_mode TEXT NOT NULL DEFAULT 'payment';

ALTER TABLE public.vending_devices
  DROP CONSTRAINT IF EXISTS vending_devices_kiosk_access_mode_check;

ALTER TABLE public.vending_devices
  ADD CONSTRAINT vending_devices_kiosk_access_mode_check
  CHECK (kiosk_access_mode IN ('payment', 'staff_pin'));

COMMENT ON COLUMN public.vending_devices.kiosk_access_mode IS
  'payment = Helcim checkout; staff_pin = staff PIN required, no payment, dispenses logged.';

CREATE TABLE IF NOT EXISTS public.vending_staff_dispenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  vending_device_id UUID NOT NULL REFERENCES public.vending_devices(id) ON DELETE CASCADE,
  staff_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  staff_name TEXT NOT NULL,
  manufacturer_goods_id TEXT NOT NULL,
  goods_name TEXT NOT NULL,
  pos_inventory_id UUID REFERENCES public.pos_inventory(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  order_no TEXT NOT NULL,
  dispensed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vending_staff_dispenses_business_at
  ON public.vending_staff_dispenses (business_id, dispensed_at DESC);

CREATE INDEX IF NOT EXISTS idx_vending_staff_dispenses_device_at
  ON public.vending_staff_dispenses (vending_device_id, dispensed_at DESC);

CREATE INDEX IF NOT EXISTS idx_vending_staff_dispenses_staff_at
  ON public.vending_staff_dispenses (staff_user_id, dispensed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vending_staff_dispenses_order_no
  ON public.vending_staff_dispenses (business_id, order_no);

ALTER TABLE public.vending_staff_dispenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vending_staff_dispenses_business_users_all ON public.vending_staff_dispenses;
CREATE POLICY vending_staff_dispenses_business_users_all
  ON public.vending_staff_dispenses
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = vending_staff_dispenses.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.business_id = vending_staff_dispenses.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = vending_staff_dispenses.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.business_id = vending_staff_dispenses.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
    )
  );

COMMENT ON TABLE public.vending_staff_dispenses IS
  'Audit log when kiosk_access_mode=staff_pin — who took what from the machine.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vending_staff_dispenses TO authenticated;
