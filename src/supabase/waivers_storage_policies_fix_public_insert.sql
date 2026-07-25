-- Fix storage RLS policies to allow public uploads during waiver signing
-- The issue: Public users can't upload signature images because the INSERT policy
-- only allows 'public' folder or authenticated business members
-- Solution: Add a separate policy for public uploads to signatures folder
--
-- NOTE: This requires owner permissions. If you get a permission error, you need to:
-- 1. Use the Supabase Dashboard > Storage > Policies
-- 2. Or use a service role key to run this
-- 3. Or contact your database administrator

-- Add a new policy specifically for public waiver signature uploads
-- This allows unauthenticated users to upload signature images during waiver signing
CREATE POLICY "Public can upload waiver signatures"
ON storage.objects FOR INSERT
TO public
WITH CHECK (
  bucket_id = 'waivers'
  AND (
    -- Allow uploads to signatures folder (path format: {business_id}/signatures/{waiver_id}.png)
    (storage.foldername(name))[2] = 'signatures'
    -- OR allow uploads to public folder (legacy support)
    OR (storage.foldername(name))[1] = 'public'
  )
);

-- Note: If the policy already exists, you'll need to drop it first:
-- DROP POLICY IF EXISTS "Public can upload waiver signatures" ON storage.objects;

