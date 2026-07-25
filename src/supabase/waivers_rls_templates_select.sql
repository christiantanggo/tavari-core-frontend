-- Step 32: Create RLS policy waiver_templates_select
-- Policy: Users can SELECT templates where they have business access

CREATE POLICY waiver_templates_select ON waiver_templates
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

-- Add comment
COMMENT ON POLICY waiver_templates_select ON waiver_templates IS 'Users can view templates for businesses they have access to via user_roles or tavari_employees';




