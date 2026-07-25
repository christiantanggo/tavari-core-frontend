-- Step 44: Create RLS policies for waiver_uploads
-- Policies: SELECT (business members, customers view own), INSERT/UPDATE/DELETE (owners/managers for uploads, customers can upload own)

-- SELECT: Business members can view all uploads for their businesses
CREATE POLICY waiver_uploads_select_business ON waiver_uploads
  FOR SELECT
  USING (
    business_id IN (
      SELECT business_id FROM user_roles 
      WHERE user_id = auth.uid() AND active = true
    )
    OR business_id IN (
      SELECT business_id FROM tavari_employees 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- SELECT: Customers can view their own uploads
CREATE POLICY waiver_uploads_select_customer ON waiver_uploads
  FOR SELECT
  USING (
    customer_id IN (
      SELECT id FROM pos_loyalty_accounts 
      WHERE id = waiver_uploads.customer_id
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
    -- Also allow if email/phone matches directly (for non-account customers)
    OR (
      email = COALESCE(
        current_setting('app.current_customer_email', true)::TEXT,
        (SELECT email FROM users WHERE id = auth.uid())
      )
      OR phone_number = COALESCE(
        current_setting('app.current_customer_phone', true)::TEXT,
        (SELECT phone FROM users WHERE id = auth.uid())
      )
    )
  );

-- INSERT: Owners/managers can upload waivers
CREATE POLICY waiver_uploads_insert_business ON waiver_uploads
  FOR INSERT
  WITH CHECK (
    business_id IN (
      SELECT business_id FROM user_roles 
      WHERE user_id = auth.uid() 
        AND active = true 
        AND role IN ('owner', 'admin', 'manager')
    )
  );

-- INSERT: Customers can upload their own waivers
CREATE POLICY waiver_uploads_insert_customer ON waiver_uploads
  FOR INSERT
  WITH CHECK (
    -- Customer must match their own account
    customer_id IN (
      SELECT id FROM pos_loyalty_accounts 
      WHERE id = waiver_uploads.customer_id
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
    -- Or email/phone matches directly
    OR (
      email = COALESCE(
        current_setting('app.current_customer_email', true)::TEXT,
        (SELECT email FROM users WHERE id = auth.uid())
      )
      OR phone_number = COALESCE(
        current_setting('app.current_customer_phone', true)::TEXT,
        (SELECT phone FROM users WHERE id = auth.uid())
      )
    )
  );

-- UPDATE: Owners/managers can update uploads
CREATE POLICY waiver_uploads_update_business ON waiver_uploads
  FOR UPDATE
  USING (
    business_id IN (
      SELECT business_id FROM user_roles 
      WHERE user_id = auth.uid() 
        AND active = true 
        AND role IN ('owner', 'admin', 'manager')
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT business_id FROM user_roles 
      WHERE user_id = auth.uid() 
        AND active = true 
        AND role IN ('owner', 'admin', 'manager')
    )
  );

-- UPDATE: Customers can update their own uploads
CREATE POLICY waiver_uploads_update_customer ON waiver_uploads
  FOR UPDATE
  USING (
    customer_id IN (
      SELECT id FROM pos_loyalty_accounts 
      WHERE id = waiver_uploads.customer_id
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
    OR (
      email = COALESCE(
        current_setting('app.current_customer_email', true)::TEXT,
        (SELECT email FROM users WHERE id = auth.uid())
      )
      OR phone_number = COALESCE(
        current_setting('app.current_customer_phone', true)::TEXT,
        (SELECT phone FROM users WHERE id = auth.uid())
      )
    )
  )
  WITH CHECK (
    customer_id IN (
      SELECT id FROM pos_loyalty_accounts 
      WHERE id = waiver_uploads.customer_id
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
    OR (
      email = COALESCE(
        current_setting('app.current_customer_email', true)::TEXT,
        (SELECT email FROM users WHERE id = auth.uid())
      )
      OR phone_number = COALESCE(
        current_setting('app.current_customer_phone', true)::TEXT,
        (SELECT phone FROM users WHERE id = auth.uid())
      )
    )
  );

-- DELETE: Owners/managers can delete uploads
CREATE POLICY waiver_uploads_delete_business ON waiver_uploads
  FOR DELETE
  USING (
    business_id IN (
      SELECT business_id FROM user_roles 
      WHERE user_id = auth.uid() 
        AND active = true 
        AND role IN ('owner', 'admin', 'manager')
    )
  );

-- DELETE: Customers can delete their own uploads
CREATE POLICY waiver_uploads_delete_customer ON waiver_uploads
  FOR DELETE
  USING (
    customer_id IN (
      SELECT id FROM pos_loyalty_accounts 
      WHERE id = waiver_uploads.customer_id
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
    OR (
      email = COALESCE(
        current_setting('app.current_customer_email', true)::TEXT,
        (SELECT email FROM users WHERE id = auth.uid())
      )
      OR phone_number = COALESCE(
        current_setting('app.current_customer_phone', true)::TEXT,
        (SELECT phone FROM users WHERE id = auth.uid())
      )
    )
  );

-- Add comments
COMMENT ON POLICY waiver_uploads_select_business ON waiver_uploads IS 'Business members can view all uploads for their businesses';
COMMENT ON POLICY waiver_uploads_select_customer ON waiver_uploads IS 'Customers can view their own uploads';
COMMENT ON POLICY waiver_uploads_insert_business ON waiver_uploads IS 'Owners/managers can upload waivers';
COMMENT ON POLICY waiver_uploads_insert_customer ON waiver_uploads IS 'Customers can upload their own waivers';
COMMENT ON POLICY waiver_uploads_update_business ON waiver_uploads IS 'Owners/managers can update uploads';
COMMENT ON POLICY waiver_uploads_update_customer ON waiver_uploads IS 'Customers can update their own uploads';
COMMENT ON POLICY waiver_uploads_delete_business ON waiver_uploads IS 'Owners/managers can delete uploads';
COMMENT ON POLICY waiver_uploads_delete_customer ON waiver_uploads IS 'Customers can delete their own uploads';




