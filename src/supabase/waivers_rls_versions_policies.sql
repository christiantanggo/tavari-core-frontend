-- Step 50: Create RLS policies for waiver_versions
-- Policies: Linked to template access (if user can view template, can view versions)

-- SELECT: Users can view versions if they can view the associated template
CREATE POLICY waiver_versions_select ON waiver_versions
  FOR SELECT
  USING (
    template_id IN (
      SELECT id FROM waiver_templates
      WHERE (
        business_id IN (
          SELECT business_id FROM user_roles 
          WHERE user_id = auth.uid() AND active = true
        )
        OR business_id IN (
          SELECT business_id FROM tavari_employees 
          WHERE user_id = auth.uid() AND is_active = true
        )
      )
    )
  );

-- INSERT: Only owners/managers can create versions
CREATE POLICY waiver_versions_insert ON waiver_versions
  FOR INSERT
  WITH CHECK (
    template_id IN (
      SELECT id FROM waiver_templates
      WHERE business_id IN (
        SELECT business_id FROM user_roles 
        WHERE user_id = auth.uid() 
          AND active = true 
          AND role IN ('owner', 'admin', 'manager')
      )
    )
  );

-- UPDATE: Only owners/managers can update versions
CREATE POLICY waiver_versions_update ON waiver_versions
  FOR UPDATE
  USING (
    template_id IN (
      SELECT id FROM waiver_templates
      WHERE business_id IN (
        SELECT business_id FROM user_roles 
        WHERE user_id = auth.uid() 
          AND active = true 
          AND role IN ('owner', 'admin', 'manager')
      )
    )
  )
  WITH CHECK (
    template_id IN (
      SELECT id FROM waiver_templates
      WHERE business_id IN (
        SELECT business_id FROM user_roles 
        WHERE user_id = auth.uid() 
          AND active = true 
          AND role IN ('owner', 'admin', 'manager')
      )
    )
  );

-- DELETE: Only owners/managers can delete versions
CREATE POLICY waiver_versions_delete ON waiver_versions
  FOR DELETE
  USING (
    template_id IN (
      SELECT id FROM waiver_templates
      WHERE business_id IN (
        SELECT business_id FROM user_roles 
        WHERE user_id = auth.uid() 
          AND active = true 
          AND role IN ('owner', 'admin', 'manager')
      )
    )
  );

-- Add comments
COMMENT ON POLICY waiver_versions_select ON waiver_versions IS 'Users can view versions if they can view the associated template';
COMMENT ON POLICY waiver_versions_insert ON waiver_versions IS 'Only owners/managers can create versions';
COMMENT ON POLICY waiver_versions_update ON waiver_versions IS 'Only owners/managers can update versions';
COMMENT ON POLICY waiver_versions_delete ON waiver_versions IS 'Only owners/managers can delete versions';




