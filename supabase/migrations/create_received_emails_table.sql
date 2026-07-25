-- Create received_emails table for storing incoming emails
CREATE TABLE IF NOT EXISTS received_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  mailbox_id UUID REFERENCES mailboxes(id) ON DELETE SET NULL,
  
  -- Email headers
  message_id TEXT, -- RFC 5322 Message-ID
  in_reply_to TEXT, -- In-Reply-To header
  email_references TEXT, -- References header (renamed to avoid reserved keyword)
  thread_id TEXT, -- Calculated thread ID for grouping conversations
  
  -- From/To/CC/BCC
  from_address TEXT NOT NULL,
  from_name TEXT,
  to_addresses TEXT[] NOT NULL, -- Array of recipient addresses
  cc_addresses TEXT[],
  bcc_addresses TEXT[],
  
  -- Subject and body
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  
  -- Attachments
  has_attachments BOOLEAN DEFAULT false,
  attachment_count INTEGER DEFAULT 0,
  
  -- Status and flags
  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'archived', 'deleted', 'spam')),
  is_important BOOLEAN DEFAULT false,
  is_starred BOOLEAN DEFAULT false,
  is_forwarded BOOLEAN DEFAULT false,
  is_replied BOOLEAN DEFAULT false,
  
  -- Email metadata
  received_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  sent_at TIMESTAMPTZ, -- From Date header
  size_bytes INTEGER, -- Email size in bytes
  
  -- Raw email data (optional, for full email storage)
  raw_email_text TEXT, -- Full raw email if needed
  
  -- Processing metadata
  processed_at TIMESTAMPTZ,
  processing_error TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_received_emails_business_id ON received_emails(business_id);
CREATE INDEX IF NOT EXISTS idx_received_emails_mailbox_id ON received_emails(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_received_emails_status ON received_emails(status);
CREATE INDEX IF NOT EXISTS idx_received_emails_received_at ON received_emails(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_received_emails_thread_id ON received_emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_received_emails_message_id ON received_emails(message_id);
CREATE INDEX IF NOT EXISTS idx_received_emails_from_address ON received_emails(from_address);
CREATE INDEX IF NOT EXISTS idx_received_emails_to_addresses ON received_emails USING GIN(to_addresses);

-- Update timestamp trigger
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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'mailboxes'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'received_emails_mailbox_id_fkey'
  ) THEN
    ALTER TABLE received_emails
      ADD CONSTRAINT received_emails_mailbox_id_fkey
      FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Enable RLS
ALTER TABLE received_emails ENABLE ROW LEVEL SECURITY;









