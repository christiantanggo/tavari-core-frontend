-- Public bucket for Tavari Vending Bridge APK (tablet install).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vending-installers',
  'vending-installers',
  true,
  104857600,
  ARRAY['application/vnd.android.package-archive', 'application/octet-stream']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS vending_installers_public_read ON storage.objects;
CREATE POLICY vending_installers_public_read
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'vending-installers');

DROP POLICY IF EXISTS vending_installers_service_upload ON storage.objects;
CREATE POLICY vending_installers_service_upload
  ON storage.objects
  FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'vending-installers');

DROP POLICY IF EXISTS vending_installers_service_update ON storage.objects;
CREATE POLICY vending_installers_service_update
  ON storage.objects
  FOR UPDATE
  TO service_role
  USING (bucket_id = 'vending-installers');
