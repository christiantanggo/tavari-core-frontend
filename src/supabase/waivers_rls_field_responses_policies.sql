-- Step 48: Create RLS policies for waiver_field_responses
-- Policies: Linked to waiver access (if user can view waiver, can view field responses)

-- SELECT: Users can view field responses if they can view the associated waiver
CREATE POLICY waiver_field_responses_select ON waiver_field_responses
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

-- INSERT: Business members, customers, and public can add field responses
CREATE POLICY waiver_field_responses_insert ON waiver_field_responses
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
        -- Customers can add responses to their own waivers
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
        -- Public can add responses during signing
        OR signature_token IS NOT NULL
      )
    )
  );

-- UPDATE: Business members, customers, and public can update field responses
CREATE POLICY waiver_field_responses_update ON waiver_field_responses
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
        OR signature_token IS NOT NULL
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
        OR signature_token IS NOT NULL
      )
    )
  );

-- DELETE: Business members and customers can delete field responses
CREATE POLICY waiver_field_responses_delete ON waiver_field_responses
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
COMMENT ON POLICY waiver_field_responses_select ON waiver_field_responses IS 'Users can view field responses if they can view the associated waiver';
COMMENT ON POLICY waiver_field_responses_insert ON waiver_field_responses IS 'Business members, customers, and public can add field responses';
COMMENT ON POLICY waiver_field_responses_update ON waiver_field_responses IS 'Business members, customers, and public can update field responses';
COMMENT ON POLICY waiver_field_responses_delete ON waiver_field_responses IS 'Business members and customers can delete field responses';




