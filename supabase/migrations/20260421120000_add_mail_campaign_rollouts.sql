CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.mail_campaign_rollouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.mail_campaigns(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'waiting_for_report'
    CHECK (status IN ('waiting_for_report', 'awaiting_approval', 'completed', 'stopped', 'failed')),
  report_email text NOT NULL,
  report_wait_minutes integer NOT NULL DEFAULT 60 CHECK (report_wait_minutes >= 5 AND report_wait_minutes <= 1440),
  batch_sizes jsonb NOT NULL DEFAULT '[50,150,300,600]'::jsonb,
  total_candidate_recipients integer NOT NULL DEFAULT 0,
  total_sent_recipients integer NOT NULL DEFAULT 0,
  started_by_user_id uuid,
  started_by_email text,
  current_batch_number integer NOT NULL DEFAULT 1,
  last_report_sent_at timestamptz,
  completed_at timestamptz,
  stopped_at timestamptz,
  stop_reason text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_campaign_rollouts_active_campaign
  ON public.mail_campaign_rollouts(campaign_id)
  WHERE status IN ('waiting_for_report', 'awaiting_approval');

CREATE INDEX IF NOT EXISTS idx_mail_campaign_rollouts_business
  ON public.mail_campaign_rollouts(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mail_campaign_rollout_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rollout_id uuid NOT NULL REFERENCES public.mail_campaign_rollouts(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.mail_campaigns(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  batch_number integer NOT NULL CHECK (batch_number > 0),
  requested_size integer NOT NULL CHECK (requested_size > 0),
  actual_size integer NOT NULL DEFAULT 0 CHECK (actual_size >= 0),
  status text NOT NULL DEFAULT 'awaiting_report'
    CHECK (status IN ('awaiting_report', 'awaiting_approval', 'completed', 'stopped', 'failed')),
  report_wait_minutes integer NOT NULL DEFAULT 60 CHECK (report_wait_minutes >= 5 AND report_wait_minutes <= 1440),
  scheduled_report_at timestamptz,
  report_sent_at timestamptz,
  approved_at timestamptz,
  approved_by_user_id uuid,
  report_email text,
  delivery_success_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  bounced_count integer NOT NULL DEFAULT 0,
  complaint_count integer NOT NULL DEFAULT 0,
  unsubscribe_count integer NOT NULL DEFAULT 0,
  opened_count integer NOT NULL DEFAULT 0,
  clicked_count integer NOT NULL DEFAULT 0,
  report_error text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (rollout_id, batch_number)
);

CREATE INDEX IF NOT EXISTS idx_mail_campaign_rollout_batches_rollout
  ON public.mail_campaign_rollout_batches(rollout_id, batch_number DESC);

CREATE INDEX IF NOT EXISTS idx_mail_campaign_rollout_batches_report_due
  ON public.mail_campaign_rollout_batches(status, scheduled_report_at);

CREATE TABLE IF NOT EXISTS public.mail_campaign_rollout_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rollout_id uuid NOT NULL REFERENCES public.mail_campaign_rollouts(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.mail_campaigns(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.mail_contacts(id) ON DELETE CASCADE,
  email_address text NOT NULL,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (rollout_id, contact_id),
  UNIQUE (rollout_id, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_mail_campaign_rollout_candidates_rollout
  ON public.mail_campaign_rollout_candidates(rollout_id, sort_order);

CREATE TABLE IF NOT EXISTS public.mail_campaign_rollout_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rollout_id uuid NOT NULL REFERENCES public.mail_campaign_rollouts(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.mail_campaign_rollout_batches(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.mail_campaigns(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.mail_contacts(id) ON DELETE CASCADE,
  email_address text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (rollout_id, contact_id),
  UNIQUE (batch_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_mail_campaign_rollout_recipients_batch
  ON public.mail_campaign_rollout_recipients(batch_id, contact_id);

ALTER TABLE public.mail_sending_queue
  ADD COLUMN IF NOT EXISTS rollout_id uuid REFERENCES public.mail_campaign_rollouts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rollout_batch_id uuid REFERENCES public.mail_campaign_rollout_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mail_sending_queue_rollout_batch
  ON public.mail_sending_queue(rollout_batch_id);

ALTER TABLE public.mail_campaign_sends
  ADD COLUMN IF NOT EXISTS rollout_id uuid REFERENCES public.mail_campaign_rollouts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rollout_batch_id uuid REFERENCES public.mail_campaign_rollout_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mail_campaign_sends_rollout_batch
  ON public.mail_campaign_sends(rollout_batch_id);

ALTER TABLE public.mail_campaign_rollouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_campaign_rollout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_campaign_rollout_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_campaign_rollout_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read campaign rollouts for their business" ON public.mail_campaign_rollouts;
CREATE POLICY "Users can read campaign rollouts for their business"
  ON public.mail_campaign_rollouts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = mail_campaign_rollouts.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = mail_campaign_rollouts.business_id
        AND ur.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can read rollout batches for their business" ON public.mail_campaign_rollout_batches;
CREATE POLICY "Users can read rollout batches for their business"
  ON public.mail_campaign_rollout_batches
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = mail_campaign_rollout_batches.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = mail_campaign_rollout_batches.business_id
        AND ur.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can read rollout candidates for their business" ON public.mail_campaign_rollout_candidates;
CREATE POLICY "Users can read rollout candidates for their business"
  ON public.mail_campaign_rollout_candidates
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = mail_campaign_rollout_candidates.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = mail_campaign_rollout_candidates.business_id
        AND ur.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can read rollout recipients for their business" ON public.mail_campaign_rollout_recipients;
CREATE POLICY "Users can read rollout recipients for their business"
  ON public.mail_campaign_rollout_recipients
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = mail_campaign_rollout_recipients.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = mail_campaign_rollout_recipients.business_id
        AND ur.user_id = auth.uid()
    )
  );
