-- Grocery list item photos (private bucket, household-scoped)
-- Path layout: {household_id}/{item_id}/{filename}

ALTER TABLE public.pullcoparent_grocery_items
  ADD COLUMN IF NOT EXISTS photo_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pullcoparent-grocery-photos',
  'pullcoparent-grocery-photos',
  false,
  10485760,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Pullcoparent grocery photos household read" ON storage.objects;
CREATE POLICY "Pullcoparent grocery photos household read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'pullcoparent-grocery-photos'
  AND public.pullcoparent_is_household_member(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "Pullcoparent grocery photos household insert" ON storage.objects;
CREATE POLICY "Pullcoparent grocery photos household insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'pullcoparent-grocery-photos'
  AND public.pullcoparent_is_household_member(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "Pullcoparent grocery photos household update" ON storage.objects;
CREATE POLICY "Pullcoparent grocery photos household update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'pullcoparent-grocery-photos'
  AND public.pullcoparent_is_household_member(((storage.foldername(name))[1])::uuid)
)
WITH CHECK (
  bucket_id = 'pullcoparent-grocery-photos'
  AND public.pullcoparent_is_household_member(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "Pullcoparent grocery photos household delete" ON storage.objects;
CREATE POLICY "Pullcoparent grocery photos household delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'pullcoparent-grocery-photos'
  AND public.pullcoparent_is_household_member(((storage.foldername(name))[1])::uuid)
);
