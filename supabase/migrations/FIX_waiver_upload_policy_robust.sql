-- Robust fix for waiver upload storage policy
-- This handles edge cases and ensures the policy works correctly

-- First, drop all existing policies
DROP POLICY IF EXISTS "Business members can view waivers" ON storage.objects;
DROP POLICY IF EXISTS "Managers/owners can view waivers" ON storage.objects;
DROP POLICY IF EXISTS "Owners/managers can upload waivers" ON storage.objects;
DROP POLICY IF EXISTS "Owners/managers can update waivers" ON storage.objects;
DROP POLICY IF EXISTS "Owners/managers can delete waivers" ON storage.objects;

-- Also drop any waiver-related policies with different names
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN 
    SELECT policyname 
    FROM pg_policies 
    WHERE tablename = 'objects' 
    AND schemaname = 'storage'
    AND (policyname ILIKE '%waiver%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
    RAISE NOTICE 'Dropped policy: %', pol.policyname;
  END LOOP;
END $$;

-- Create INSERT policy with more robust checking
-- This uses a helper function approach that's more reliable
CREATE POLICY "Owners/managers can upload waivers"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'waivers'
  AND (
    -- Path structure: paper-waivers/{business_id}/{filename}
    -- Extract business_id from path and check permissions
    EXISTS (
      SELECT 1
      FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('owner', 'admin', 'manager')
        AND ur.active = true
        AND (
          -- Check if path starts with paper-waivers/{business_id}
          (
            (storage.foldername(name))[1] = 'paper-waivers'
            AND (storage.foldername(name))[2] = ur.business_id::text
          )
          -- OR direct business_id path (backward compatibility)
          OR (storage.foldername(name))[1] = ur.business_id::text
          -- OR public path
          OR (storage.foldername(name))[1] = 'public'
        )
    )
  )
);

-- Create SELECT policy for viewing (managers only)
CREATE POLICY "Managers/owners can view waivers"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'waivers'
  AND EXISTS (
    SELECT 1
    FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin', 'manager')
      AND ur.active = true
      AND (
        -- paper-waivers/{business_id}/...
        ((storage.foldername(name))[1] = 'paper-waivers' AND (storage.foldername(name))[2] = ur.business_id::text)
        -- OR direct {business_id}/...
        OR (storage.foldername(name))[1] = ur.business_id::text
        -- OR public/...
        OR (storage.foldername(name))[1] = 'public'
      )
  )
);

-- Create UPDATE policy
CREATE POLICY "Owners/managers can update waivers"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'waivers'
  AND EXISTS (
    SELECT 1
    FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin', 'manager')
      AND ur.active = true
      AND (
        ((storage.foldername(name))[1] = 'paper-waivers' AND (storage.foldername(name))[2] = ur.business_id::text)
        OR (storage.foldername(name))[1] = ur.business_id::text
      )
  )
)
WITH CHECK (
  bucket_id = 'waivers'
  AND EXISTS (
    SELECT 1
    FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin', 'manager')
      AND ur.active = true
      AND (
        ((storage.foldername(name))[1] = 'paper-waivers' AND (storage.foldername(name))[2] = ur.business_id::text)
        OR (storage.foldername(name))[1] = ur.business_id::text
      )
  )
);

-- Create DELETE policy
CREATE POLICY "Owners/managers can delete waivers"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'waivers'
  AND EXISTS (
    SELECT 1
    FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin', 'manager')
      AND ur.active = true
      AND (
        ((storage.foldername(name))[1] = 'paper-waivers' AND (storage.foldername(name))[2] = ur.business_id::text)
        OR (storage.foldername(name))[1] = ur.business_id::text
      )
  )
);

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

-- Verify policies were created
SELECT 
  policyname,
  cmd,
  CASE 
    WHEN with_check IS NOT NULL THEN 'WITH CHECK present'
    WHEN qual IS NOT NULL THEN 'USING clause present'
    ELSE 'No condition'
  END as policy_type
FROM pg_policies 
WHERE tablename = 'objects' 
  AND schemaname = 'storage'
  AND policyname ILIKE '%waiver%'
ORDER BY policyname, cmd;

