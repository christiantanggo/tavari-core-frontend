-- Name of the Day: daily picks + configurable scoring profiles (JSON)

CREATE TABLE IF NOT EXISTS public.mail_name_of_day_picks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  girl_display_name text NOT NULL,
  boy_display_name text NOT NULL,
  girl_normalized text NOT NULL,
  boy_normalized text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT mail_name_of_day_picks_business_day UNIQUE (business_id, local_date)
);

CREATE INDEX IF NOT EXISTS idx_mail_name_of_day_picks_business_date
  ON public.mail_name_of_day_picks (business_id, local_date DESC);

COMMENT ON TABLE public.mail_name_of_day_picks IS 'Daily girl/boy display names chosen for Name of the Day promos';

CREATE TABLE IF NOT EXISTS public.mail_name_of_day_settings (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  send_hour smallint NOT NULL DEFAULT 7 CHECK (send_hour >= 0 AND send_hour <= 23),
  send_minute smallint NOT NULL DEFAULT 0 CHECK (send_minute >= 0 AND send_minute <= 59),
  profiles jsonb NOT NULL DEFAULT '{}'::jsonb,
  dow_profile_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON COLUMN public.mail_name_of_day_settings.profiles IS 'Named scoring profiles (popularity quintile points, etc.)';
COMMENT ON COLUMN public.mail_name_of_day_settings.dow_profile_ids IS 'Maps JS day-of-week 0=Sun..6=Sat to profile id string';

ALTER TABLE public.mail_name_of_day_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_name_of_day_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Business users read name of day picks" ON public.mail_name_of_day_picks;
CREATE POLICY "Business users read name of day picks"
  ON public.mail_name_of_day_picks FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.business_users bu WHERE bu.business_id = mail_name_of_day_picks.business_id AND bu.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.business_id = mail_name_of_day_picks.business_id AND ur.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Business users manage name of day picks" ON public.mail_name_of_day_picks;
CREATE POLICY "Business users manage name of day picks"
  ON public.mail_name_of_day_picks FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.business_users bu WHERE bu.business_id = mail_name_of_day_picks.business_id AND bu.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.business_id = mail_name_of_day_picks.business_id AND ur.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.business_users bu WHERE bu.business_id = mail_name_of_day_picks.business_id AND bu.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.business_id = mail_name_of_day_picks.business_id AND ur.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Business users read name of day settings" ON public.mail_name_of_day_settings;
CREATE POLICY "Business users read name of day settings"
  ON public.mail_name_of_day_settings FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.business_users bu WHERE bu.business_id = mail_name_of_day_settings.business_id AND bu.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.business_id = mail_name_of_day_settings.business_id AND ur.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Business users upsert name of day settings" ON public.mail_name_of_day_settings;
CREATE POLICY "Business users upsert name of day settings"
  ON public.mail_name_of_day_settings FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.business_users bu WHERE bu.business_id = mail_name_of_day_settings.business_id AND bu.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.business_id = mail_name_of_day_settings.business_id AND ur.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Business users update name of day settings" ON public.mail_name_of_day_settings;
CREATE POLICY "Business users update name of day settings"
  ON public.mail_name_of_day_settings FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.business_users bu WHERE bu.business_id = mail_name_of_day_settings.business_id AND bu.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.business_id = mail_name_of_day_settings.business_id AND ur.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.business_users bu WHERE bu.business_id = mail_name_of_day_settings.business_id AND bu.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.business_id = mail_name_of_day_settings.business_id AND ur.user_id = auth.uid())
  );

-- Minor pool for edge function (service role / SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.mail_name_of_day_minor_pool(p_business_id uuid)
RETURNS TABLE (
  participant_id uuid,
  waiver_id uuid,
  minor_first text,
  minor_dob date,
  guardian_email text,
  signed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    wp.id,
    wp.waiver_id,
    btrim(wp.first_name),
    wp.date_of_birth::date,
    lower(btrim(coalesce(ws.email, ''))),
    ws.signed_at
  FROM public.waiver_participants wp
  INNER JOIN public.waiver_signatures ws ON ws.id = wp.waiver_id
  WHERE ws.business_id = p_business_id
    AND length(btrim(wp.first_name)) > 0
    AND lower(btrim(coalesce(wp.participant_type, ''))) = 'minor';
$$;

COMMENT ON FUNCTION public.mail_name_of_day_minor_pool(uuid) IS 'Eligible waiver minors for Name of the Day scoring (participant_type = minor)';

GRANT EXECUTE ON FUNCTION public.mail_name_of_day_minor_pool(uuid) TO service_role;
