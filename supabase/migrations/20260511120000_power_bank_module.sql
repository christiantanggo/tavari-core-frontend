-- Tavari Power Bank (ChargeNow / Bajie Open API) — module catalog, per-business settings, webhook audit

INSERT INTO public.app_modules (module_key, module_name, description, icon, enabled_by_default, module_category)
VALUES (
  'power_bank',
  'Power Bank',
  'Shared charging cabinets: ChargeNow API, shop & pricing control, cabinet ops, ads & webhooks',
  'FiZap',
  false,
  'Operations'
)
ON CONFLICT (module_key) DO UPDATE SET
  module_name = EXCLUDED.module_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  module_category = EXCLUDED.module_category;

-- Optional mapping + notes per Tavari business (vendor shop id for shortcuts in UI)
CREATE TABLE IF NOT EXISTS public.business_chargenow_settings (
  business_id UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  vendor_shop_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_chargenow_settings_shop ON public.business_chargenow_settings (vendor_shop_id)
  WHERE vendor_shop_id IS NOT NULL;

-- Inbound webhook audit (Edge Functions insert via service role)
CREATE TABLE IF NOT EXISTS public.chargenow_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
  event_source TEXT NOT NULL CHECK (event_source IN ('rent_callback', 'cabinet_event')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chargenow_webhook_events_business ON public.chargenow_webhook_events (business_id);
CREATE INDEX IF NOT EXISTS idx_chargenow_webhook_events_created ON public.chargenow_webhook_events (created_at DESC);

ALTER TABLE public.business_chargenow_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chargenow_webhook_events ENABLE ROW LEVEL SECURITY;

-- Settings: business members can read/write their row
DROP POLICY IF EXISTS business_chargenow_settings_select ON public.business_chargenow_settings;
CREATE POLICY business_chargenow_settings_select
  ON public.business_chargenow_settings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = business_chargenow_settings.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.business_id = business_chargenow_settings.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
    )
  );

DROP POLICY IF EXISTS business_chargenow_settings_upsert ON public.business_chargenow_settings;
CREATE POLICY business_chargenow_settings_upsert
  ON public.business_chargenow_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = business_chargenow_settings.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'admin', 'manager')
    )
  );

DROP POLICY IF EXISTS business_chargenow_settings_update ON public.business_chargenow_settings;
CREATE POLICY business_chargenow_settings_update
  ON public.business_chargenow_settings
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = business_chargenow_settings.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = business_chargenow_settings.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'admin', 'manager')
    )
  );

-- Webhook log: managers can read rows for their business (null business_id rows are staff-only via dashboard filters — hide from RLS by not selecting null)
DROP POLICY IF EXISTS chargenow_webhook_events_select ON public.chargenow_webhook_events;
CREATE POLICY chargenow_webhook_events_select
  ON public.chargenow_webhook_events
  FOR SELECT
  TO authenticated
  USING (
    business_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = chargenow_webhook_events.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'admin', 'manager')
    )
  );

COMMENT ON TABLE public.business_chargenow_settings IS 'ChargeNow vendor shop id and notes per Tavari business';
COMMENT ON TABLE public.chargenow_webhook_events IS 'Audit log for ChargeNow rent callbacks and cabinet event pushes';
