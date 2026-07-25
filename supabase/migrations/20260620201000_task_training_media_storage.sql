-- Public storage bucket for task-specific training images, videos, and documents.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task-training-media',
  'task-training-media',
  true,
  104857600,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Task training media public read" ON storage.objects;
CREATE POLICY "Task training media public read"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (bucket_id = 'task-training-media');

DROP POLICY IF EXISTS "Task training media authenticated upload" ON storage.objects;
CREATE POLICY "Task training media authenticated upload"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'task-training-media');

DROP POLICY IF EXISTS "Task training media authenticated update" ON storage.objects;
CREATE POLICY "Task training media authenticated update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'task-training-media')
WITH CHECK (bucket_id = 'task-training-media');

DROP POLICY IF EXISTS "Task training media authenticated delete" ON storage.objects;
CREATE POLICY "Task training media authenticated delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'task-training-media');
