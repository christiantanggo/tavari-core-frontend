-- Enhance security for waivers storage bucket
-- Restrict viewing to managers/owners/admins only

-- Drop ALL existing waiver storage policies to avoid conflicts
-- Note: PostgreSQL array indices are 1-based, so [1] is first element, [2] is second, etc.
-- Path structure: paper-waivers/{business_id}/{timestamp}-{filename}
-- So: [1] = "paper-waivers", [2] = business_id, [3] = filename

DROP POLICY IF EXISTS "Business members can view waivers" ON storage.objects;
DROP POLICY IF EXISTS "Managers/owners can view waivers" ON storage.objects;
DROP POLICY IF EXISTS "Owners/managers can upload waivers" ON storage.objects;
DROP POLICY IF EXISTS "Owners/managers can update waivers" ON storage.objects;
DROP POLICY IF EXISTS "Owners/managers can delete waivers" ON storage.objects;

-- Also drop any policies that might exist with slightly different names
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN 
    SELECT policyname 
    FROM pg_policies 
    WHERE tablename = 'objects' 
    AND schemaname = 'storage'
    AND (policyname LIKE '%waiver%' OR policyname LIKE '%Waiver%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

-- Create a more restrictive SELECT policy: Only managers/owners/admins can view waiver files
-- Path structure: paper-waivers/{business_id}/{timestamp}-{filename}
-- So business_id is at index [2] (1-indexed: [1]=paper-waivers, [2]=business_id)
CREATE POLICY "Managers/owners can view waivers"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'waivers'
  AND (
    -- Only managers/owners/admins can view
    -- Check both possible path structures: paper-waivers/{business_id}/... and {business_id}/...
    (
      (storage.foldername(name))[1] = 'paper-waivers' 
      AND (storage.foldername(name))[2] IN (
        SELECT business_id::text 
        FROM user_roles 
        WHERE user_id = auth.uid() 
          AND active = true
          AND role IN ('owner', 'admin', 'manager')
      )
    )
    OR (
      -- Direct business_id path (for other waiver types)
      (storage.foldername(name))[1] IN (
        SELECT business_id::text 
        FROM user_roles 
        WHERE user_id = auth.uid() 
          AND active = true
          AND role IN ('owner', 'admin', 'manager')
      )
    )
    -- OR public waiver signing (signature_token in path) - keep this for public waiver signing
    OR (storage.foldername(name))[1] = 'public'
  )
);

-- Ensure INSERT is still restricted to managers/owners only
-- Path structure: paper-waivers/{business_id}/{timestamp}-{filename}
DROP POLICY IF EXISTS "Owners/managers can upload waivers" ON storage.objects;
CREATE POLICY "Owners/managers can upload waivers"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'waivers'
  AND (
    -- Check both possible path structures: paper-waivers/{business_id}/... and {business_id}/...
    (
      (storage.foldername(name))[1] = 'paper-waivers' 
      AND (storage.foldername(name))[2] IN (
        SELECT business_id::text 
        FROM user_roles 
        WHERE user_id = auth.uid() 
          AND role IN ('owner', 'admin', 'manager')
          AND active = true
      )
    )
    OR (
      -- Direct business_id path (for other waiver types)
      (storage.foldername(name))[1] IN (
        SELECT business_id::text 
        FROM user_roles 
        WHERE user_id = auth.uid() 
          AND role IN ('owner', 'admin', 'manager')
          AND active = true
      )
    )
    -- OR public waiver signing (signature_token in path)
    OR (storage.foldername(name))[1] = 'public'
  )
);

-- Ensure UPDATE is restricted to managers/owners only
-- Path structure: paper-waivers/{business_id}/{timestamp}-{filename}
DROP POLICY IF EXISTS "Owners/managers can update waivers" ON storage.objects;
CREATE POLICY "Owners/managers can update waivers"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'waivers'
  AND (
    (
      (storage.foldername(name))[1] = 'paper-waivers' 
      AND (storage.foldername(name))[2] IN (
        SELECT business_id::text 
        FROM user_roles 
        WHERE user_id = auth.uid() 
          AND role IN ('owner', 'admin', 'manager')
          AND active = true
      )
    )
    OR (
      (storage.foldername(name))[1] IN (
        SELECT business_id::text 
        FROM user_roles 
        WHERE user_id = auth.uid() 
          AND role IN ('owner', 'admin', 'manager')
          AND active = true
      )
    )
  )
)
WITH CHECK (
  bucket_id = 'waivers'
  AND (
    (
      (storage.foldername(name))[1] = 'paper-waivers' 
      AND (storage.foldername(name))[2] IN (
        SELECT business_id::text 
        FROM user_roles 
        WHERE user_id = auth.uid() 
          AND role IN ('owner', 'admin', 'manager')
          AND active = true
      )
    )
    OR (
      (storage.foldername(name))[1] IN (
        SELECT business_id::text 
        FROM user_roles 
        WHERE user_id = auth.uid() 
          AND role IN ('owner', 'admin', 'manager')
          AND active = true
      )
    )
  )
);

-- Ensure DELETE is restricted to managers/owners only
-- Path structure: paper-waivers/{business_id}/{timestamp}-{filename}
DROP POLICY IF EXISTS "Owners/managers can delete waivers" ON storage.objects;
CREATE POLICY "Owners/managers can delete waivers"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'waivers'
  AND (
    (
      (storage.foldername(name))[1] = 'paper-waivers' 
      AND (storage.foldername(name))[2] IN (
        SELECT business_id::text 
        FROM user_roles 
        WHERE user_id = auth.uid() 
          AND role IN ('owner', 'admin', 'manager')
          AND active = true
      )
    )
    OR (
      (storage.foldername(name))[1] IN (
        SELECT business_id::text 
        FROM user_roles 
        WHERE user_id = auth.uid() 
          AND role IN ('owner', 'admin', 'manager')
          AND active = true
      )
    )
  )
);

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';

