-- Step 46: Create RLS policies for waiver_fields
-- Policies: Linked to template access (if user can view template, can view fields)

-- SELECT: Users can view fields if they can view the associated template
CREATE POLICY waiver_fields_select ON waiver_fields
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

-- INSERT: Only owners/managers can create fields
CREATE POLICY waiver_fields_insert ON waiver_fields
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

-- UPDATE: Only owners/managers can update fields
CREATE POLICY waiver_fields_update ON waiver_fields
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

-- DELETE: Only owners/managers can delete fields
CREATE POLICY waiver_fields_delete ON waiver_fields
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
COMMENT ON POLICY waiver_fields_select ON waiver_fields IS 'Users can view fields if they can view the associated template';
COMMENT ON POLICY waiver_fields_insert ON waiver_fields IS 'Only owners/managers can create fields';
COMMENT ON POLICY waiver_fields_update ON waiver_fields IS 'Only owners/managers can update fields';
COMMENT ON POLICY waiver_fields_delete ON waiver_fields IS 'Only owners/managers can delete fields';




