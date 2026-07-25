CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.mail_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL UNIQUE REFERENCES public.mail_campaigns(id) ON DELETE CASCADE,
  name text NOT NULL,
  automation_type text NOT NULL
    CHECK (automation_type IN ('birthday', 'day-camp', 'summer-camp', 'we-miss-you', 'custom')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  trigger_timing text NOT NULL DEFAULT 'event_day'
    CHECK (trigger_timing IN ('before_event', 'event_day', 'after_event', 'custom_window')),
  days_offset integer NOT NULL DEFAULT 0,
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  personalization jsonb NOT NULL DEFAULT '{"include_loyalty_points": true}'::jsonb,
  created_by uuid,
  last_saved_by uuid,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_mail_automations_business
  ON public.mail_automations(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mail_automations_status
  ON public.mail_automations(business_id, status, automation_type);

ALTER TABLE public.mail_automations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read mail automations for their business" ON public.mail_automations;
CREATE POLICY "Users can read mail automations for their business"
  ON public.mail_automations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = mail_automations.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = mail_automations.business_id
        AND ur.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert mail automations for their business" ON public.mail_automations;
CREATE POLICY "Users can insert mail automations for their business"
  ON public.mail_automations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = mail_automations.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = mail_automations.business_id
        AND ur.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update mail automations for their business" ON public.mail_automations;
CREATE POLICY "Users can update mail automations for their business"
  ON public.mail_automations
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = mail_automations.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = mail_automations.business_id
        AND ur.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = mail_automations.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = mail_automations.business_id
        AND ur.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete mail automations for their business" ON public.mail_automations;
CREATE POLICY "Users can delete mail automations for their business"
  ON public.mail_automations
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = mail_automations.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = mail_automations.business_id
        AND ur.user_id = auth.uid()
    )
  );
