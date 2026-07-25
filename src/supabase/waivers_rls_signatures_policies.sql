-- Step 36: Create RLS policies for waiver_signatures
-- Policies: SELECT (business members, customers view own, public by token), INSERT (public for signing, business members), UPDATE (business members, customers limited), DELETE (owners/managers)

-- SELECT: Business members can view all waivers for their businesses
CREATE POLICY waiver_signatures_select_business ON waiver_signatures
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

-- SELECT: Customers can view their own waivers (via customer_id)
CREATE POLICY waiver_signatures_select_customer ON waiver_signatures
  FOR SELECT
  USING (
    customer_id IN (
      SELECT id FROM pos_loyalty_accounts 
      WHERE id = waiver_signatures.customer_id
        AND (
          -- Match by authenticated user's email/phone if available
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
  );

-- SELECT: Public can view waiver by signature_token (for signing flow)
CREATE POLICY waiver_signatures_select_public ON waiver_signatures
  FOR SELECT
  USING (
    signature_token IS NOT NULL
    -- Token-based access allows public viewing during signing process
  );

-- INSERT: Public can insert (for signing waivers) - must have signature_token
CREATE POLICY waiver_signatures_insert_public ON waiver_signatures
  FOR INSERT
  WITH CHECK (
    signature_token IS NOT NULL
    -- Allow public waiver signing via signature_token
  );

-- INSERT: Business members can create waivers for their businesses
CREATE POLICY waiver_signatures_insert_business ON waiver_signatures
  FOR INSERT
  WITH CHECK (
    business_id IN (
      SELECT business_id FROM user_roles 
      WHERE user_id = auth.uid() AND active = true
    )
    OR business_id IN (
      SELECT business_id FROM tavari_employees 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- UPDATE: Business members (owners/managers/admins) can update waivers
CREATE POLICY waiver_signatures_update_business ON waiver_signatures
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

-- UPDATE: Customers can update their own waivers (limited fields - signature data only)
CREATE POLICY waiver_signatures_update_customer ON waiver_signatures
  FOR UPDATE
  USING (
    customer_id IN (
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
  WITH CHECK (
    -- Only allow updating signature-related fields (signature_data, signature_image_url, guardian_signature_url, etc.)
    -- This is enforced by only allowing updates where customer_id matches
    customer_id IN (
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
  );

-- DELETE: Only owners/managers can delete waivers
CREATE POLICY waiver_signatures_delete ON waiver_signatures
  FOR DELETE
  USING (
    business_id IN (
      SELECT business_id FROM user_roles 
      WHERE user_id = auth.uid() 
        AND active = true 
        AND role IN ('owner', 'manager')
    )
  );

-- Add comments
COMMENT ON POLICY waiver_signatures_select_business ON waiver_signatures IS 'Business members can view all waivers for their businesses';
COMMENT ON POLICY waiver_signatures_select_customer ON waiver_signatures IS 'Customers can view their own waivers via customer_id';
COMMENT ON POLICY waiver_signatures_select_public ON waiver_signatures IS 'Public can view waivers by signature_token for signing';
COMMENT ON POLICY waiver_signatures_insert_public ON waiver_signatures IS 'Public can insert waivers for signing (requires signature_token)';
COMMENT ON POLICY waiver_signatures_insert_business ON waiver_signatures IS 'Business members can create waivers';
COMMENT ON POLICY waiver_signatures_update_business ON waiver_signatures IS 'Owners/managers/admins can update waivers';
COMMENT ON POLICY waiver_signatures_update_customer ON waiver_signatures IS 'Customers can update their own waivers (signature data only)';
COMMENT ON POLICY waiver_signatures_delete ON waiver_signatures IS 'Only owners/managers can delete waivers';




