-- Storage policies for social-media-images bucket
-- Policies: SELECT (public), INSERT/UPDATE/DELETE (authenticated users)

-- SELECT policy: Public access (needed for Instagram/Facebook to fetch images)
DROP POLICY IF EXISTS "Public can view social media images" ON storage.objects;
CREATE POLICY "Public can view social media images"
ON storage.objects FOR SELECT
USING (bucket_id = 'social-media-images');

-- INSERT policy: Authenticated users can upload images
DROP POLICY IF EXISTS "Authenticated users can upload social media images" ON storage.objects;
CREATE POLICY "Authenticated users can upload social media images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'social-media-images' 
  AND auth.role() = 'authenticated'
);

-- UPDATE policy: Authenticated users can update images
DROP POLICY IF EXISTS "Authenticated users can update social media images" ON storage.objects;
CREATE POLICY "Authenticated users can update social media images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'social-media-images' 
  AND auth.role() = 'authenticated'
);

-- DELETE policy: Authenticated users can delete images
DROP POLICY IF EXISTS "Authenticated users can delete social media images" ON storage.objects;
CREATE POLICY "Authenticated users can delete social media images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'social-media-images' 
  AND auth.role() = 'authenticated'
);

