-- Step 38: Create RLS policies for waiver_participants
-- Policies: Linked to waiver access (if user can view waiver, can view participants)

-- SELECT: Users can view participants if they can view the associated waiver
CREATE POLICY waiver_participants_select ON waiver_participants
  FOR SELECT
  USING (
    waiver_id IN (
      SELECT id FROM waiver_signatures
      WHERE (
        -- Business members can view
        business_id IN (
          SELECT business_id FROM user_roles 
          WHERE user_id = auth.uid() AND active = true
        )
        OR business_id IN (
          SELECT business_id FROM tavari_employees 
          WHERE user_id = auth.uid() AND is_active = true
        )
        -- Customers can view their own
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
        -- Public can view by signature_token
        OR signature_token IS NOT NULL
      )
    )
  );

-- INSERT: Business members can add participants to waivers they can access
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

-- UPDATE: Business members and customers can update participants
CREATE POLICY waiver_participants_update ON waiver_participants
  FOR UPDATE
  USING (
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
      )
    )
  )
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
      )
    )
  );

-- DELETE: Business members and customers can delete participants
CREATE POLICY waiver_participants_delete ON waiver_participants
  FOR DELETE
  USING (
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
      )
    )
  );

-- Add comments
COMMENT ON POLICY waiver_participants_select ON waiver_participants IS 'Users can view participants if they can view the associated waiver';
COMMENT ON POLICY waiver_participants_insert ON waiver_participants IS 'Business members, customers, and public (via signature_token) can add participants to waivers they can access';
COMMENT ON POLICY waiver_participants_update ON waiver_participants IS 'Business members and customers can update participants';
COMMENT ON POLICY waiver_participants_delete ON waiver_participants IS 'Business members and customers can delete participants';




