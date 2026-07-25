-- Enhance security for waiver_uploads table
-- Restrict viewing to managers/owners/admins only (removing permissive business member access)

-- Drop the existing permissive SELECT policy that allows all business members to view
DROP POLICY IF EXISTS waiver_uploads_select_business ON waiver_uploads;

-- Create a more restrictive SELECT policy: Only managers/owners/admins can view
CREATE POLICY waiver_uploads_select_managers_only ON waiver_uploads
  FOR SELECT
  USING (
    business_id IN (
      SELECT business_id FROM user_roles 
      WHERE user_id = auth.uid() 
        AND active = true 
        AND role IN ('owner', 'admin', 'manager')
    )
    OR business_id IN (
      SELECT business_id FROM tavari_employees 
      WHERE user_id = auth.uid() 
        AND is_active = true
        AND role IN ('owner', 'admin', 'manager')
    )
  );

-- Keep the customer SELECT policy for customers viewing their own uploads
-- (This is already restricted and fine)

-- Ensure INSERT is still restricted to managers/owners only
-- (The existing policy is already correct, but let's verify it's there)
-- If the policy doesn't exist, create it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'waiver_uploads' 
    AND policyname = 'waiver_uploads_insert_business'
  ) THEN
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
  END IF;
END $$;

-- Ensure UPDATE is restricted to managers/owners only
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'waiver_uploads' 
    AND policyname = 'waiver_uploads_update_business'
  ) THEN
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
  END IF;
END $$;

-- Ensure DELETE is restricted to managers/owners only
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'waiver_uploads' 
    AND policyname = 'waiver_uploads_delete_business'
  ) THEN
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
  END IF;
END $$;

-- Add comments for documentation
COMMENT ON POLICY waiver_uploads_select_managers_only ON waiver_uploads IS 
  'Only managers, owners, and admins can view paper waiver uploads - enhanced security for sensitive documents';

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';





