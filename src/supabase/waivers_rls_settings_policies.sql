-- Step 40: Create RLS policies for waiver_settings
-- Policies: SELECT (business members), INSERT/UPDATE/DELETE (owners/managers only)

-- SELECT: Business members can view settings
CREATE POLICY waiver_settings_select ON waiver_settings
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

-- INSERT: Only owners/managers can create settings
CREATE POLICY waiver_settings_insert ON waiver_settings
  FOR INSERT
  WITH CHECK (
    business_id IN (
      SELECT business_id FROM user_roles 
      WHERE user_id = auth.uid() 
        AND active = true 
        AND role IN ('owner', 'admin', 'manager')
    )
  );

-- UPDATE: Only owners/managers can update settings
CREATE POLICY waiver_settings_update ON waiver_settings
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

-- DELETE: Only owners/managers can delete settings
CREATE POLICY waiver_settings_delete ON waiver_settings
  FOR DELETE
  USING (
    business_id IN (
      SELECT business_id FROM user_roles 
      WHERE user_id = auth.uid() 
        AND active = true 
        AND role IN ('owner', 'admin', 'manager')
    )
  );

-- Add comments
COMMENT ON POLICY waiver_settings_select ON waiver_settings IS 'Business members can view waiver settings';
COMMENT ON POLICY waiver_settings_insert ON waiver_settings IS 'Only owners/managers can create waiver settings';
COMMENT ON POLICY waiver_settings_update ON waiver_settings IS 'Only owners/managers can update waiver settings';
COMMENT ON POLICY waiver_settings_delete ON waiver_settings IS 'Only owners/managers can delete waiver settings';




