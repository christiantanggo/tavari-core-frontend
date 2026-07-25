CREATE TABLE IF NOT EXISTS public.scheduling_notification_settings (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.scheduling_notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Scheduling notification settings business access" ON public.scheduling_notification_settings;

CREATE POLICY "Scheduling notification settings business access"
  ON public.scheduling_notification_settings
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_notification_settings.business_id
        AND bu.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_notification_settings.business_id
        AND bu.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.touch_scheduling_notification_settings_updated_at()
RETURNS trigger
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$
LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_scheduling_notification_settings_updated_at
  ON public.scheduling_notification_settings;

CREATE TRIGGER trg_touch_scheduling_notification_settings_updated_at
BEFORE UPDATE ON public.scheduling_notification_settings
FOR EACH ROW
EXECUTE FUNCTION public.touch_scheduling_notification_settings_updated_at();
