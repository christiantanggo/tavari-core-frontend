-- Step 34: Create RLS policy waiver_templates_update
-- Policy: Users can UPDATE templates for businesses where they are owner/manager/admin

CREATE POLICY waiver_templates_update ON waiver_templates
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

-- Add comment
COMMENT ON POLICY waiver_templates_update ON waiver_templates IS 'Only owners, admins, and managers can update waiver templates';




