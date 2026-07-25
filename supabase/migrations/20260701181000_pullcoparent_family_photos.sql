-- Family photo slideshow on home screen (shared per household)
-- Path layout: {household_id}/{filename}

CREATE TABLE IF NOT EXISTS public.pullcoparent_family_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.pullcoparent_households(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  caption text,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pullcoparent_family_photos_household
  ON public.pullcoparent_family_photos (household_id, sort_order, created_at);

ALTER TABLE public.pullcoparent_family_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pullcoparent_family_photos_all_member ON public.pullcoparent_family_photos;
CREATE POLICY pullcoparent_family_photos_all_member ON public.pullcoparent_family_photos
  FOR ALL TO authenticated
  USING (public.pullcoparent_is_household_member(household_id))
  WITH CHECK (public.pullcoparent_is_household_member(household_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pullcoparent_family_photos TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pullcoparent-family-photos',
  'pullcoparent-family-photos',
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

DROP POLICY IF EXISTS "Pullcoparent family photos household read" ON storage.objects;
CREATE POLICY "Pullcoparent family photos household read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'pullcoparent-family-photos'
  AND public.pullcoparent_is_household_member(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "Pullcoparent family photos household insert" ON storage.objects;
CREATE POLICY "Pullcoparent family photos household insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'pullcoparent-family-photos'
  AND public.pullcoparent_is_household_member(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "Pullcoparent family photos household update" ON storage.objects;
CREATE POLICY "Pullcoparent family photos household update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'pullcoparent-family-photos'
  AND public.pullcoparent_is_household_member(((storage.foldername(name))[1])::uuid)
)
WITH CHECK (
  bucket_id = 'pullcoparent-family-photos'
  AND public.pullcoparent_is_household_member(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "Pullcoparent family photos household delete" ON storage.objects;
CREATE POLICY "Pullcoparent family photos household delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'pullcoparent-family-photos'
  AND public.pullcoparent_is_household_member(((storage.foldername(name))[1])::uuid)
);
