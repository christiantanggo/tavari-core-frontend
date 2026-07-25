-- Browser punch clock uses an isolated anon Supabase client. It must be able to
-- upload verification photos before the SECURITY DEFINER RPC writes the URL to
-- scheduling_time_clocks.

INSERT INTO storage.buckets (id, name, public)
VALUES ('time-clock-photos', 'time-clock-photos', true)
ON CONFLICT (id) DO UPDATE
SET public = true;

DROP POLICY IF EXISTS "Allow public read access to time clock photos" ON storage.objects;
CREATE POLICY "Allow public read access to time clock photos"
ON storage.objects
FOR SELECT
USING (bucket_id = 'time-clock-photos');

DROP POLICY IF EXISTS "Allow punch clock kiosk anon upload time clock photos" ON storage.objects;
CREATE POLICY "Allow punch clock kiosk anon upload time clock photos"
ON storage.objects
FOR INSERT
TO anon
WITH CHECK (
  bucket_id = 'time-clock-photos'
  AND (storage.foldername(name))[1] = 'kiosk'
);

DROP POLICY IF EXISTS "Allow authenticated users to upload time clock photos" ON storage.objects;
CREATE POLICY "Allow authenticated users to upload time clock photos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'time-clock-photos');
