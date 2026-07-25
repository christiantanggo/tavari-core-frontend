-- Public waiver + legacy kiosk upload signature PNGs to bucket waivers under:
--   signatures/{business_uuid}/{waiver_uuid}-{suffix}-{timestamp}.png
-- Existing policies only allow INSERT for paper-waivers/*, {business_id}/* (first segment),
-- or public/* — not signatures/*, so anon uploads returned 400.

DROP POLICY IF EXISTS "Waiver signature PNGs anon insert" ON storage.objects;
CREATE POLICY "Waiver signature PNGs anon insert"
  ON storage.objects
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    bucket_id = 'waivers'
    AND (storage.foldername(name))[1] = 'signatures'
    AND (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

-- Allow browsers to load signature images via public object URLs (anon GET).
DROP POLICY IF EXISTS "Waiver signature PNGs anon select" ON storage.objects;
CREATE POLICY "Waiver signature PNGs anon select"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (
    bucket_id = 'waivers'
    AND (storage.foldername(name))[1] = 'signatures'
    AND (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

NOTIFY pgrst, 'reload schema';
