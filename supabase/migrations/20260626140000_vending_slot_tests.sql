-- RS485 slot checklist: track lane bytes and pass/fail before paid go-live.

CREATE TABLE IF NOT EXISTS public.vending_device_slot_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  vending_device_id UUID NOT NULL REFERENCES public.vending_devices(id) ON DELETE CASCADE,
  sev_no TEXT NOT NULL DEFAULT '1',
  row_num INTEGER NOT NULL CHECK (row_num >= 1),
  col_num INTEGER NOT NULL CHECK (col_num >= 1),
  rs485_lane_byte INTEGER CHECK (rs485_lane_byte IS NULL OR (rs485_lane_byte >= 0 AND rs485_lane_byte <= 99)),
  test_status TEXT NOT NULL DEFAULT 'untested'
    CHECK (test_status IN ('untested', 'pass', 'fail')),
  tested_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vending_device_id, sev_no, row_num, col_num)
);

CREATE INDEX IF NOT EXISTS idx_vending_device_slot_tests_device
  ON public.vending_device_slot_tests (vending_device_id);

CREATE INDEX IF NOT EXISTS idx_vending_device_slot_tests_business
  ON public.vending_device_slot_tests (business_id);

ALTER TABLE public.vending_device_slot_tests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vending_device_slot_tests_business_users_all ON public.vending_device_slot_tests;
CREATE POLICY vending_device_slot_tests_business_users_all
  ON public.vending_device_slot_tests
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = vending_device_slot_tests.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.business_id = vending_device_slot_tests.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = vending_device_slot_tests.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.business_id = vending_device_slot_tests.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vending_device_slot_tests TO authenticated;

COMMENT ON TABLE public.vending_device_slot_tests IS
  'Pre-go-live RS485 slot checklist: lane byte mapping and pass/fail per physical slot.';
