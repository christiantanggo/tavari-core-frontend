-- Allow business members to update received_emails (status: read/unread, archived, deleted)
-- Required for EmailInbox mark-read, archive, delete actions
DROP POLICY IF EXISTS "Users can update received emails for their business" ON received_emails;
CREATE POLICY "Users can update received emails for their business"
  ON received_emails FOR UPDATE
  USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  )
  WITH CHECK (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );
