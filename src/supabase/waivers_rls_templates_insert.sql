-- Step 33: Create RLS policy waiver_templates_insert
-- Policy: Users can INSERT templates for businesses where they are owner/manager/admin

CREATE POLICY waiver_templates_insert ON waiver_templates
  FOR INSERT
  WITH CHECK (
    business_id IN (
      SELECT business_id FROM user_roles 
      WHERE user_id = auth.uid() 
        AND active = true 
        AND role IN ('owner', 'admin', 'manager')
    )
  );

-- Add comment
COMMENT ON POLICY waiver_templates_insert ON waiver_templates IS 'Only owners, admins, and managers can create waiver templates';




