-- Step 19: Create storage policies for appbuilder-assets
-- Policies: SELECT, INSERT, UPDATE, DELETE based on business_id access
-- Uses user_roles table to verify access (matches existing pattern)

-- SELECT policy: Business members can view assets
DROP POLICY IF EXISTS "Business members can view appbuilder assets" ON storage.objects;
CREATE POLICY "Business members can view appbuilder assets"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'appbuilder-assets'
  AND (
    -- Extract business_id from path (format: {business_id}/...)
    (storage.foldername(name))[1] IN (
      SELECT business_id::text 
      FROM user_roles 
      WHERE user_id = auth.uid() 
        AND active = true
    )
  )
);

-- INSERT policy: Owners/managers can upload assets
DROP POLICY IF EXISTS "Owners/managers can upload appbuilder assets" ON storage.objects;
CREATE POLICY "Owners/managers can upload appbuilder assets"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'appbuilder-assets'
  AND (
    -- Extract business_id from path
    (storage.foldername(name))[1] IN (
      SELECT business_id::text 
      FROM user_roles 
      WHERE user_id = auth.uid() 
        AND role IN ('owner', 'admin', 'manager')
        AND active = true
    )
  )
);

-- UPDATE policy: Owners/managers can update assets
DROP POLICY IF EXISTS "Owners/managers can update appbuilder assets" ON storage.objects;
CREATE POLICY "Owners/managers can update appbuilder assets"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'appbuilder-assets'
  AND (
    (storage.foldername(name))[1] IN (
      SELECT business_id::text 
      FROM user_roles 
      WHERE user_id = auth.uid() 
        AND role IN ('owner', 'admin', 'manager')
        AND active = true
    )
  )
);

-- DELETE policy: Owners/managers can delete assets
DROP POLICY IF EXISTS "Owners/managers can delete appbuilder assets" ON storage.objects;
CREATE POLICY "Owners/managers can delete appbuilder assets"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'appbuilder-assets'
  AND (
    (storage.foldername(name))[1] IN (
      SELECT business_id::text 
      FROM user_roles 
      WHERE user_id = auth.uid() 
        AND role IN ('owner', 'admin', 'manager')
        AND active = true
    )
  )
);




