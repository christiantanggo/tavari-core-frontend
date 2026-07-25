-- QUICK FIX: Fix waiver upload storage policy immediately
-- This fixes the "new row violates row-level security policy" error when uploading waivers
-- Run this in Supabase SQL Editor to fix the issue immediately

-- Drop all existing waiver storage policies first
DROP POLICY IF EXISTS "Business members can view waivers" ON storage.objects;
DROP POLICY IF EXISTS "Managers/owners can view waivers" ON storage.objects;
DROP POLICY IF EXISTS "Owners/managers can upload waivers" ON storage.objects;
DROP POLICY IF EXISTS "Owners/managers can update waivers" ON storage.objects;
DROP POLICY IF EXISTS "Owners/managers can delete waivers" ON storage.objects;

-- Create INSERT policy that handles the actual path structure: paper-waivers/{business_id}/{filename}
CREATE POLICY "Owners/managers can upload waivers"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'waivers'
  AND (
    -- Path structure: paper-waivers/{business_id}/{filename}
    -- Check if [1] = 'paper-waivers' AND [2] = business_id
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
    -- OR direct business_id path (for backward compatibility)
    OR (
      (storage.foldername(name))[1] IN (
        SELECT business_id::text 
        FROM user_roles 
        WHERE user_id = auth.uid() 
          AND role IN ('owner', 'admin', 'manager')
          AND active = true
      )
    )
    -- OR public waiver signing
    OR (storage.foldername(name))[1] = 'public'
  )
);

-- Create SELECT policy for viewing (managers only)
CREATE POLICY "Managers/owners can view waivers"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'waivers'
  AND (
    -- Path structure: paper-waivers/{business_id}/{filename}
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
    -- OR direct business_id path
    OR (
      (storage.foldername(name))[1] IN (
        SELECT business_id::text 
        FROM user_roles 
        WHERE user_id = auth.uid() 
          AND active = true
          AND role IN ('owner', 'admin', 'manager')
      )
    )
    -- OR public waiver signing
    OR (storage.foldername(name))[1] = 'public'
  )
);

-- Create UPDATE policy
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

-- Create DELETE policy
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

-- Verify the policy was created
SELECT 
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'objects' 
  AND schemaname = 'storage'
  AND policyname LIKE '%waiver%'
ORDER BY policyname;





