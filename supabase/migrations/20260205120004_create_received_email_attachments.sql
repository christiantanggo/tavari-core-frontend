-- Accounting MVP: attachments from received emails (references received_emails)

CREATE TABLE IF NOT EXISTS received_email_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_email_id UUID NOT NULL REFERENCES received_emails(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT,
  size_bytes INTEGER,
  checksum TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_received_email_attachments_received_email_id ON received_email_attachments(received_email_id);

-- RLS: user can see attachments for emails in their business (via received_emails.business_id)
ALTER TABLE received_email_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view attachments for received emails in their business" ON received_email_attachments;
CREATE POLICY "Users can view attachments for received emails in their business"
  ON received_email_attachments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM received_emails re
      JOIN business_users bu ON bu.business_id = re.business_id AND bu.user_id = auth.uid()
      WHERE re.id = received_email_attachments.received_email_id
    )
  );

-- Insert/Update from receive-email Edge Function use service role (bypasses RLS)
