-- Create public bucket for music desktop installers
-- This allows direct downloads from Supabase Storage

-- First, try to update existing bucket
UPDATE storage.buckets
SET 
  public = true,
  file_size_limit = 1048576000, -- 1GB limit (1000 MB)
  allowed_mime_types = ARRAY[
    'application/zip',
    'application/x-zip-compressed',
    'application/octet-stream',
    'application/x-msdownload'
  ]
WHERE id = 'music-installers';

-- If bucket doesn't exist, create it
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT
  'music-installers',
  'music-installers',
  true,
  1048576000, -- 1GB limit (1000 MB)
  ARRAY[
    'application/zip',
    'application/x-zip-compressed',
    'application/octet-stream',
    'application/x-msdownload'
  ]
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'music-installers');

-- Allow public read access
DROP POLICY IF EXISTS "Public read access for installers" ON storage.objects;
CREATE POLICY "Public read access for installers"
ON storage.objects FOR SELECT
USING (bucket_id = 'music-installers');

-- Allow authenticated uploads (for admins)
DROP POLICY IF EXISTS "Authenticated upload for installers" ON storage.objects;
CREATE POLICY "Authenticated upload for installers"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'music-installers' 
  AND auth.role() = 'authenticated'
);

-- Allow authenticated updates (for admins)
DROP POLICY IF EXISTS "Authenticated update for installers" ON storage.objects;
CREATE POLICY "Authenticated update for installers"
ON storage.objects FOR UPDATE
USING (bucket_id = 'music-installers' AND auth.role() = 'authenticated');

