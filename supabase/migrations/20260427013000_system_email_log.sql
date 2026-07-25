CREATE TABLE IF NOT EXISTS public.system_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  email_type text NOT NULL DEFAULT 'marketing'
    CHECK (email_type IN ('marketing', 'transactional')),
  source_module text NOT NULL DEFAULT 'unknown',
  source_id text,
  campaign_id uuid REFERENCES public.mail_campaigns(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.mail_contacts(id) ON DELETE SET NULL,
  mailbox_id uuid REFERENCES public.mailboxes(id) ON DELETE SET NULL,
  recipient_email text,
  from_email text NOT NULL,
  from_name text,
  to_addresses text[] NOT NULL DEFAULT ARRAY[]::text[],
  cc_addresses text[] NOT NULL DEFAULT ARRAY[]::text[],
  bcc_addresses text[] NOT NULL DEFAULT ARRAY[]::text[],
  subject text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'failed', 'blocked', 'suppressed', 'unsubscribed')),
  ses_message_id text,
  error_message text,
  body_html text,
  body_text text,
  body_snapshot_expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_system_email_log_business_created
  ON public.system_email_log (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_email_log_business_type
  ON public.system_email_log (business_id, email_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_email_log_business_status
  ON public.system_email_log (business_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_email_log_contact
  ON public.system_email_log (business_id, contact_id, created_at DESC);

ALTER TABLE public.system_email_log
  ADD COLUMN IF NOT EXISTS mailbox_id uuid REFERENCES public.mailboxes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recipient_email text,
  ADD COLUMN IF NOT EXISTS to_addresses text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS cc_addresses text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS bcc_addresses text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS body_html text,
  ADD COLUMN IF NOT EXISTS body_text text,
  ADD COLUMN IF NOT EXISTS body_snapshot_expires_at timestamptz;

UPDATE public.system_email_log
SET to_addresses = ARRAY[recipient_email]
WHERE recipient_email IS NOT NULL
  AND cardinality(to_addresses) = 0;

ALTER TABLE public.system_email_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view system email log for their business" ON public.system_email_log;
CREATE POLICY "Users can view system email log for their business"
  ON public.system_email_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = system_email_log.business_id
        AND bu.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = system_email_log.business_id
        AND ur.user_id = auth.uid()
    )
  );

GRANT SELECT ON public.system_email_log TO authenticated;

COMMENT ON TABLE public.system_email_log IS
  'System-wide outbound email history. mail-send writes one row per send attempt across marketing and transactional modules.';
