-- Step 167: Create WaiverStoragePolicies.sql
-- Storage policies for waivers bucket
-- Policies: SELECT, INSERT, UPDATE, DELETE based on business_id access
-- Uses business_users table to verify access (matches existing pattern)
--
-- IMPORTANT: The 'waivers' storage bucket must exist before running this script.
-- If you haven't created it yet:
-- 1. Go to Supabase Dashboard > Storage
-- 2. Click "New bucket"
-- 3. Name: "waivers"
-- 4. Public: false
-- 5. File size limit: 50MB
-- 6. Allowed MIME types: application/pdf, image/png, image/jpeg, image/jpg, image/gif, image/webp
-- 7. Then run this script to create the policies

-- SELECT policy: Business members can view waivers
DROP POLICY IF EXISTS "Business members can view waivers" ON storage.objects;
CREATE POLICY "Business members can view waivers"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'waivers'
  AND (
    -- Extract business_id from path (format: {business_id}/...)
    (storage.foldername(name))[1] IN (
      SELECT business_id::text 
      FROM user_roles 
      WHERE user_id = auth.uid() 
        AND active = true
    )
    -- OR public waiver signing (signature_token in path)
    OR (storage.foldername(name))[1] = 'public'
  )
);

-- INSERT policy: Owners/managers can upload waivers
DROP POLICY IF EXISTS "Owners/managers can upload waivers" ON storage.objects;
CREATE POLICY "Owners/managers can upload waivers"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'waivers'
  AND (
    -- Extract business_id from path
    (storage.foldername(name))[1] IN (
      SELECT business_id::text 
      FROM user_roles 
      WHERE user_id = auth.uid() 
        AND role IN ('owner', 'admin', 'manager')
        AND active = true
    )
    -- OR public waiver signing (signature_token in path)
    OR (storage.foldername(name))[1] = 'public'
  )
);

-- UPDATE policy: Owners/managers can update waivers
DROP POLICY IF EXISTS "Owners/managers can update waivers" ON storage.objects;
CREATE POLICY "Owners/managers can update waivers"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'waivers'
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

-- DELETE policy: Owners/managers can delete waivers
DROP POLICY IF EXISTS "Owners/managers can delete waivers" ON storage.objects;
CREATE POLICY "Owners/managers can delete waivers"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'waivers'
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

-- Policies created successfully
-- Note: Comments on policies require elevated permissions, so they are omitted here

