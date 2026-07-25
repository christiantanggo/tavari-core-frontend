-- Fix: Allow public inserts to waiver_participants for waivers with signature_token
-- This fixes the issue where participants (minors, additional adults) cannot be saved
-- during the public waiver signing flow
-- 
-- IMPORTANT: This script only updates the INSERT policy. Do not run the full policy file.

-- Drop the existing INSERT policy if it exists
DROP POLICY IF EXISTS waiver_participants_insert ON waiver_participants;

-- Recreate the INSERT policy with public access for signature_token waivers
CREATE POLICY waiver_participants_insert ON waiver_participants
  FOR INSERT
  WITH CHECK (
    waiver_id IN (
      SELECT id FROM waiver_signatures
      WHERE (
        business_id IN (
          SELECT business_id FROM user_roles 
          WHERE user_id = auth.uid() AND active = true
        )
        OR business_id IN (
          SELECT business_id FROM tavari_employees 
          WHERE user_id = auth.uid() AND is_active = true
        )
        -- Customers can add participants to their own waivers
        OR customer_id IN (
          SELECT id FROM pos_loyalty_accounts 
          WHERE id = waiver_signatures.customer_id
            AND (
              customer_email = COALESCE(
                current_setting('app.current_customer_email', true)::TEXT,
                (SELECT email FROM users WHERE id = auth.uid())
              )
              OR customer_phone = COALESCE(
                current_setting('app.current_customer_phone', true)::TEXT,
                (SELECT phone FROM users WHERE id = auth.uid())
              )
            )
        )
        -- Public can add participants during signing (waiver has signature_token)
        OR signature_token IS NOT NULL
      )
    )
  );

-- Update comment
COMMENT ON POLICY waiver_participants_insert ON waiver_participants IS 'Business members, customers, and public (via signature_token) can add participants to waivers they can access';
