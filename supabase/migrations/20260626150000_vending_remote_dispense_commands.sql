-- Remote RS485 dispense: dashboard queues commands; tablet kiosk APK executes locally.

ALTER TABLE public.vending_devices
  ADD COLUMN IF NOT EXISTS kiosk_bridge_last_seen_at TIMESTAMPTZ;

COMMENT ON COLUMN public.vending_devices.kiosk_bridge_last_seen_at IS
  'Updated when Tavari Vending tablet polls for remote dispense commands.';

CREATE TABLE IF NOT EXISTS public.vending_device_dispense_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  vending_device_id UUID NOT NULL REFERENCES public.vending_devices(id) ON DELETE CASCADE,
  lane_byte INTEGER NOT NULL CHECK (lane_byte >= 0 AND lane_byte <= 99),
  row_num INTEGER,
  col_num INTEGER,
  source TEXT NOT NULL DEFAULT 'dashboard'
    CHECK (source IN ('dashboard', 'kiosk', 'api')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'expired')),
  result JSONB,
  error_message TEXT,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes')
);

CREATE INDEX IF NOT EXISTS idx_vending_dispense_commands_device_pending
  ON public.vending_device_dispense_commands (vending_device_id, created_at)
  WHERE status IN ('pending', 'running');

ALTER TABLE public.vending_device_dispense_commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vending_dispense_commands_business_users_all ON public.vending_device_dispense_commands;
CREATE POLICY vending_dispense_commands_business_users_all
  ON public.vending_device_dispense_commands
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = vending_device_dispense_commands.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.business_id = vending_device_dispense_commands.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = vending_device_dispense_commands.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.business_id = vending_device_dispense_commands.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.vending_device_dispense_commands TO authenticated;

COMMENT ON TABLE public.vending_device_dispense_commands IS
  'Queue for remote RS485 test vends from dashboard → tablet Tavari Vending APK.';
