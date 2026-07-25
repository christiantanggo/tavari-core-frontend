-- Ensure received_emails exists before timestamped accounting/email migrations reference it.
-- This intentionally avoids a hard FK on mailbox_id at create time because legacy mailbox
-- migrations are untimestamped and may run later on a fresh install.

CREATE TABLE IF NOT EXISTS received_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  mailbox_id UUID,

  message_id TEXT,
  in_reply_to TEXT,
  email_references TEXT,
  thread_id TEXT,

  from_address TEXT NOT NULL,
  from_name TEXT,
  to_addresses TEXT[] NOT NULL,
  cc_addresses TEXT[],
  bcc_addresses TEXT[],

  subject TEXT,
  body_text TEXT,
  body_html TEXT,

  has_attachments BOOLEAN DEFAULT false,
  attachment_count INTEGER DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'archived', 'deleted', 'spam')),
  is_important BOOLEAN DEFAULT false,
  is_starred BOOLEAN DEFAULT false,
  is_forwarded BOOLEAN DEFAULT false,
  is_replied BOOLEAN DEFAULT false,

  received_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  sent_at TIMESTAMPTZ,
  size_bytes INTEGER,
  raw_email_text TEXT,
  processed_at TIMESTAMPTZ,
  processing_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_received_emails_business_id ON received_emails(business_id);
CREATE INDEX IF NOT EXISTS idx_received_emails_mailbox_id ON received_emails(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_received_emails_status ON received_emails(status);
CREATE INDEX IF NOT EXISTS idx_received_emails_received_at ON received_emails(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_received_emails_thread_id ON received_emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_received_emails_message_id ON received_emails(message_id);
CREATE INDEX IF NOT EXISTS idx_received_emails_from_address ON received_emails(from_address);
CREATE INDEX IF NOT EXISTS idx_received_emails_to_addresses ON received_emails USING GIN(to_addresses);

CREATE OR REPLACE FUNCTION update_received_emails_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_received_emails_updated_at ON received_emails;
CREATE TRIGGER trg_received_emails_updated_at
BEFORE UPDATE ON received_emails
FOR EACH ROW
EXECUTE FUNCTION update_received_emails_updated_at();

ALTER TABLE received_emails ENABLE ROW LEVEL SECURITY;
