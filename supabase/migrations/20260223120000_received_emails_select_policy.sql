-- Allow business members to read received_emails (e.g. body_html) for re-extract from email.
DROP POLICY IF EXISTS "Users can view received emails for their business" ON received_emails;
CREATE POLICY "Users can view received emails for their business"
  ON received_emails FOR SELECT
  USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );
