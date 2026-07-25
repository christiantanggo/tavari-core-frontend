-- Tavari Reminder — employee operational reminders (email + portal; SMS post-MVP)

INSERT INTO public.app_modules (module_key, module_name, description, icon, enabled_by_default, module_category)
VALUES (
  'reminders',
  'Tavari Reminder',
  'Schedule employee email and portal reminders with complete and snooze actions',
  'FiBell',
  false,
  'Operations'
)
ON CONFLICT (module_key) DO UPDATE SET
  module_name = EXCLUDED.module_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  module_category = EXCLUDED.module_category;

-- ---------------------------------------------------------------------------
-- Core reminder definition
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tavari_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('once', 'weekly', 'monthly')),
  schedule_time TEXT NOT NULL DEFAULT '09:00',
  schedule_day_of_week SMALLINT CHECK (schedule_day_of_week IS NULL OR (schedule_day_of_week >= 0 AND schedule_day_of_week <= 6)),
  schedule_day_of_month SMALLINT CHECK (schedule_day_of_month IS NULL OR (schedule_day_of_month >= 1 AND schedule_day_of_month <= 31)),
  schedule_once_date DATE,
  starts_on DATE NOT NULL DEFAULT ((timezone('utc', now()))::date),
  ends_on DATE,
  max_occurrences INT CHECK (max_occurrences IS NULL OR max_occurrences >= 1),
  occurrences_sent INT NOT NULL DEFAULT 0,
  send_on_weekends BOOLEAN NOT NULL DEFAULT false,
  paused BOOLEAN NOT NULL DEFAULT false,
  snooze_max INT CHECK (snooze_max IS NULL OR snooze_max >= 0),
  custom_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  manual_emails TEXT[] NOT NULL DEFAULT '{}'::text[],
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tavari_reminders_business ON public.tavari_reminders (business_id, paused, updated_at DESC);

-- Staff recipients (portal + email when user has email)
CREATE TABLE IF NOT EXISTS public.tavari_reminder_staff_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id UUID NOT NULL REFERENCES public.tavari_reminders(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reminder_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tavari_reminder_staff_business ON public.tavari_reminder_staff_recipients (business_id, user_id);

-- Each scheduled fire instance
CREATE TABLE IF NOT EXISTS public.tavari_reminder_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id UUID NOT NULL REFERENCES public.tavari_reminders(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  planned_date DATE NOT NULL,
  send_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'completed', 'cancelled')),
  snooze_count INT NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tavari_reminder_occurrences_dispatch
  ON public.tavari_reminder_occurrences (status, send_at)
  WHERE status IN ('pending', 'sent');

CREATE INDEX IF NOT EXISTS idx_tavari_reminder_occurrences_reminder
  ON public.tavari_reminder_occurrences (reminder_id, planned_date DESC);

-- Per-channel delivery log
CREATE TABLE IF NOT EXISTS public.tavari_reminder_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id UUID NOT NULL REFERENCES public.tavari_reminder_occurrences(id) ON DELETE CASCADE,
  reminder_id UUID NOT NULL REFERENCES public.tavari_reminders(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'portal')),
  recipient_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  recipient_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error_message TEXT,
  mail_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tavari_reminder_deliveries_occurrence
  ON public.tavari_reminder_deliveries (occurrence_id);

-- Signed email action tokens
CREATE TABLE IF NOT EXISTS public.tavari_reminder_action_tokens (
  token TEXT PRIMARY KEY,
  occurrence_id UUID NOT NULL REFERENCES public.tavari_reminder_occurrences(id) ON DELETE CASCADE,
  delivery_id UUID REFERENCES public.tavari_reminder_deliveries(id) ON DELETE CASCADE,
  recipient_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  recipient_email TEXT,
  action TEXT NOT NULL CHECK (action IN ('complete', 'snooze')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tavari_reminder_action_tokens_occurrence
  ON public.tavari_reminder_action_tokens (occurrence_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tavari_reminder_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tavari_reminders_updated_at ON public.tavari_reminders;
CREATE TRIGGER trg_tavari_reminders_updated_at
  BEFORE UPDATE ON public.tavari_reminders
  FOR EACH ROW EXECUTE FUNCTION public.tavari_reminder_touch_updated_at();

DROP TRIGGER IF EXISTS trg_tavari_reminder_occurrences_updated_at ON public.tavari_reminder_occurrences;
CREATE TRIGGER trg_tavari_reminder_occurrences_updated_at
  BEFORE UPDATE ON public.tavari_reminder_occurrences
  FOR EACH ROW EXECUTE FUNCTION public.tavari_reminder_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tavari_reminder_is_business_member(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.business_users bu
    WHERE bu.business_id = p_business_id AND bu.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.business_id = p_business_id AND ur.user_id = auth.uid() AND ur.active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.tavari_reminder_is_business_manager(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.business_users bu
    WHERE bu.business_id = p_business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('owner', 'admin', 'manager')
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.business_id = p_business_id
      AND ur.user_id = auth.uid()
      AND ur.active = true
      AND ur.role IN ('owner', 'admin', 'manager')
  );
$$;

ALTER TABLE public.tavari_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tavari_reminder_staff_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tavari_reminder_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tavari_reminder_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tavari_reminder_action_tokens ENABLE ROW LEVEL SECURITY;

-- reminders
DROP POLICY IF EXISTS tavari_reminders_select ON public.tavari_reminders;
CREATE POLICY tavari_reminders_select ON public.tavari_reminders FOR SELECT TO authenticated
  USING (public.tavari_reminder_is_business_member(business_id));

DROP POLICY IF EXISTS tavari_reminders_insert ON public.tavari_reminders;
CREATE POLICY tavari_reminders_insert ON public.tavari_reminders FOR INSERT TO authenticated
  WITH CHECK (public.tavari_reminder_is_business_manager(business_id));

DROP POLICY IF EXISTS tavari_reminders_update ON public.tavari_reminders;
CREATE POLICY tavari_reminders_update ON public.tavari_reminders FOR UPDATE TO authenticated
  USING (public.tavari_reminder_is_business_manager(business_id))
  WITH CHECK (public.tavari_reminder_is_business_manager(business_id));

DROP POLICY IF EXISTS tavari_reminders_delete ON public.tavari_reminders;
CREATE POLICY tavari_reminders_delete ON public.tavari_reminders FOR DELETE TO authenticated
  USING (public.tavari_reminder_is_business_manager(business_id));

-- staff recipients
DROP POLICY IF EXISTS tavari_reminder_staff_select ON public.tavari_reminder_staff_recipients;
CREATE POLICY tavari_reminder_staff_select ON public.tavari_reminder_staff_recipients FOR SELECT TO authenticated
  USING (public.tavari_reminder_is_business_member(business_id));

DROP POLICY IF EXISTS tavari_reminder_staff_mutate ON public.tavari_reminder_staff_recipients;
CREATE POLICY tavari_reminder_staff_mutate ON public.tavari_reminder_staff_recipients FOR ALL TO authenticated
  USING (public.tavari_reminder_is_business_manager(business_id))
  WITH CHECK (public.tavari_reminder_is_business_manager(business_id));

-- occurrences (managers read; writes via service role from edge functions)
DROP POLICY IF EXISTS tavari_reminder_occurrences_select ON public.tavari_reminder_occurrences;
CREATE POLICY tavari_reminder_occurrences_select ON public.tavari_reminder_occurrences FOR SELECT TO authenticated
  USING (public.tavari_reminder_is_business_member(business_id));

-- deliveries
DROP POLICY IF EXISTS tavari_reminder_deliveries_select ON public.tavari_reminder_deliveries;
CREATE POLICY tavari_reminder_deliveries_select ON public.tavari_reminder_deliveries FOR SELECT TO authenticated
  USING (public.tavari_reminder_is_business_member(business_id));

-- action tokens: service role only (no authenticated policies)

GRANT EXECUTE ON FUNCTION public.tavari_reminder_is_business_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tavari_reminder_is_business_manager(uuid) TO authenticated;

-- Cron secret placeholder (optional; edge function also accepts service role)
INSERT INTO public.system_runtime_secrets (key_name, secret_value)
VALUES ('reminder_dispatch_cron_secret', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (key_name) DO NOTHING;
