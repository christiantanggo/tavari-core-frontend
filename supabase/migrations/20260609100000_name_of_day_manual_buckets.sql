-- Manual girl/boy/unisex buckets per normalized minor first name (no waiver gender required).

CREATE TABLE IF NOT EXISTS public.mail_name_of_day_name_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  normalized_name text NOT NULL,
  girl_eligible boolean NOT NULL DEFAULT false,
  boy_eligible boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT mail_name_of_day_name_classifications_unique UNIQUE (business_id, normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_mail_nod_name_class_business
  ON public.mail_name_of_day_name_classifications (business_id);

COMMENT ON TABLE public.mail_name_of_day_name_classifications IS
  'Per-business placement of minor first names into girl/boy slots for Name of the Day when manual mode is enabled.';

ALTER TABLE public.mail_settings
  ADD COLUMN IF NOT EXISTS name_of_day_use_manual_buckets boolean NOT NULL DEFAULT false;

ALTER TABLE public.mail_settings
  ADD COLUMN IF NOT EXISTS name_inventory_last_refreshed_at timestamptz;

ALTER TABLE public.mail_settings
  ADD COLUMN IF NOT EXISTS name_of_day_alert_email text;

ALTER TABLE public.mail_settings
  ADD COLUMN IF NOT EXISTS name_of_day_alert_send_hour smallint
    CHECK (name_of_day_alert_send_hour IS NULL OR (name_of_day_alert_send_hour >= 0 AND name_of_day_alert_send_hour <= 23));

ALTER TABLE public.mail_settings
  ADD COLUMN IF NOT EXISTS name_of_day_alert_send_minute smallint
    CHECK (name_of_day_alert_send_minute IS NULL OR (name_of_day_alert_send_minute >= 0 AND name_of_day_alert_send_minute <= 59));

ALTER TABLE public.mail_settings
  ADD COLUMN IF NOT EXISTS name_of_day_last_pool_alert_sent_on date;

COMMENT ON COLUMN public.mail_settings.name_of_day_use_manual_buckets IS
  'When true, Name of the Day picks only from mail_name_of_day_name_classifications ∩ current minor pool (max age).';

COMMENT ON COLUMN public.mail_settings.name_of_day_alert_email IS
  'Optional: receive one alert per local day when manual buckets cannot fill girl+boy picks.';

ALTER TABLE public.mail_name_of_day_name_classifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mail_nod_classifications_select"
  ON public.mail_name_of_day_name_classifications FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = mail_name_of_day_name_classifications.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.business_id = mail_name_of_day_name_classifications.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
    )
  );

CREATE POLICY "mail_nod_classifications_insert"
  ON public.mail_name_of_day_name_classifications FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = mail_name_of_day_name_classifications.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.business_id = mail_name_of_day_name_classifications.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
    )
  );

CREATE POLICY "mail_nod_classifications_update"
  ON public.mail_name_of_day_name_classifications FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = mail_name_of_day_name_classifications.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.business_id = mail_name_of_day_name_classifications.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
    )
  );

CREATE POLICY "mail_nod_classifications_delete"
  ON public.mail_name_of_day_name_classifications FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = mail_name_of_day_name_classifications.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.business_id = mail_name_of_day_name_classifications.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
    )
  );
