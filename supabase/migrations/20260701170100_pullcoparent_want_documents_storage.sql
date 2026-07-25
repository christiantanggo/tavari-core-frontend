-- Child want documents (brochures, flyers, etc.)
-- Path layout: {household_id}/{want_id}/{filename}

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pullcoparent-want-documents',
  'pullcoparent-want-documents',
  false,
  10485760,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Pullcoparent want docs household read" ON storage.objects;
CREATE POLICY "Pullcoparent want docs household read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'pullcoparent-want-documents'
  AND public.pullcoparent_is_household_member(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "Pullcoparent want docs household insert" ON storage.objects;
CREATE POLICY "Pullcoparent want docs household insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'pullcoparent-want-documents'
  AND public.pullcoparent_is_household_member(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "Pullcoparent want docs household delete" ON storage.objects;
CREATE POLICY "Pullcoparent want docs household delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'pullcoparent-want-documents'
  AND public.pullcoparent_is_household_member(((storage.foldername(name))[1])::uuid)
);
