CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.mail_automations
  ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_mail_automations_enabled
  ON public.mail_automations (business_id, is_enabled, status, automation_type);

CREATE TABLE IF NOT EXISTS public.mail_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES public.mail_automations(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.mail_campaigns(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.mail_contacts(id) ON DELETE CASCADE,
  email_address text NOT NULL,
  automation_type text NOT NULL,
  delivery_key text NOT NULL,
  trigger_date date NOT NULL,
  event_date date,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'retrying', 'sent', 'failed', 'cancelled')),
  last_error text,
  queued_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_automation_runs_unique_delivery
  ON public.mail_automation_runs (automation_id, contact_id, delivery_key);

CREATE INDEX IF NOT EXISTS idx_mail_automation_runs_status
  ON public.mail_automation_runs (business_id, automation_id, status, trigger_date DESC);

ALTER TABLE public.mail_sending_queue
  ADD COLUMN IF NOT EXISTS automation_id uuid REFERENCES public.mail_automations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS automation_run_id uuid REFERENCES public.mail_automation_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mail_sending_queue_automation
  ON public.mail_sending_queue (automation_id, automation_run_id);

ALTER TABLE public.mail_automation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read mail automation runs for their business" ON public.mail_automation_runs;
CREATE POLICY "Users can read mail automation runs for their business"
  ON public.mail_automation_runs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = mail_automation_runs.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = mail_automation_runs.business_id
        AND ur.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert mail automation runs for their business" ON public.mail_automation_runs;
CREATE POLICY "Users can insert mail automation runs for their business"
  ON public.mail_automation_runs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = mail_automation_runs.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = mail_automation_runs.business_id
        AND ur.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update mail automation runs for their business" ON public.mail_automation_runs;
CREATE POLICY "Users can update mail automation runs for their business"
  ON public.mail_automation_runs
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = mail_automation_runs.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = mail_automation_runs.business_id
        AND ur.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = mail_automation_runs.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = mail_automation_runs.business_id
        AND ur.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete mail automation runs for their business" ON public.mail_automation_runs;
CREATE POLICY "Users can delete mail automation runs for their business"
  ON public.mail_automation_runs
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = mail_automation_runs.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = mail_automation_runs.business_id
        AND ur.user_id = auth.uid()
    )
  );
