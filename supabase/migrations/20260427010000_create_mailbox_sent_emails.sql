CREATE TABLE IF NOT EXISTS public.mailbox_sent_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  mailbox_id UUID NOT NULL REFERENCES public.mailboxes(id) ON DELETE CASCADE,
  source_received_email_id UUID REFERENCES public.received_emails(id) ON DELETE SET NULL,

  from_email TEXT NOT NULL,
  from_name TEXT,
  to_addresses TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  cc_addresses TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  bcc_addresses TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  subject TEXT NOT NULL,
  body_text TEXT,
  body_html TEXT,

  thread_id TEXT,
  in_reply_to TEXT,
  email_references TEXT,
  ses_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  error_message TEXT,

  sent_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_mailbox_sent_emails_business_id
  ON public.mailbox_sent_emails(business_id);

CREATE INDEX IF NOT EXISTS idx_mailbox_sent_emails_mailbox_id
  ON public.mailbox_sent_emails(mailbox_id);

CREATE INDEX IF NOT EXISTS idx_mailbox_sent_emails_sent_at
  ON public.mailbox_sent_emails(sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_mailbox_sent_emails_thread_id
  ON public.mailbox_sent_emails(thread_id);

CREATE OR REPLACE FUNCTION public.update_mailbox_sent_emails_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mailbox_sent_emails_updated_at ON public.mailbox_sent_emails;
CREATE TRIGGER trg_mailbox_sent_emails_updated_at
BEFORE UPDATE ON public.mailbox_sent_emails
FOR EACH ROW
EXECUTE FUNCTION public.update_mailbox_sent_emails_updated_at();

ALTER TABLE public.mailbox_sent_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view sent mailbox emails for their business" ON public.mailbox_sent_emails;
CREATE POLICY "Users can view sent mailbox emails for their business"
  ON public.mailbox_sent_emails FOR SELECT
  USING (
    business_id IN (
      SELECT business_id FROM public.user_roles
      WHERE user_id = auth.uid() AND active = true
    )
    OR business_id IN (
      SELECT business_id FROM public.business_users
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can create sent mailbox emails for their business" ON public.mailbox_sent_emails;
CREATE POLICY "Users can create sent mailbox emails for their business"
  ON public.mailbox_sent_emails FOR INSERT
  WITH CHECK (
    business_id IN (
      SELECT business_id FROM public.user_roles
      WHERE user_id = auth.uid() AND active = true
    )
    OR business_id IN (
      SELECT business_id FROM public.business_users
      WHERE user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.mailbox_sent_emails IS 'Sent message history for Tavari webmail mailboxes.';
COMMENT ON COLUMN public.mailbox_sent_emails.source_received_email_id IS 'Original received email when this sent message is a reply or forward.';
