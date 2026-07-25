-- Create storage bucket for time clock photos
-- Note: This should be run in Supabase Dashboard > Storage section

-- Create bucket (if it doesn't exist)
INSERT INTO storage.buckets (id, name, public)
VALUES ('time-clock-photos', 'time-clock-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Set up RLS policies for the bucket
CREATE POLICY "Allow public read access to time clock photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'time-clock-photos');

CREATE POLICY "Allow authenticated users to upload time clock photos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'time-clock-photos' 
  AND auth.role() = 'authenticated'
);

CREATE POLICY "Allow authenticated users to update time clock photos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'time-clock-photos' 
  AND auth.role() = 'authenticated'
);

CREATE POLICY "Allow authenticated users to delete time clock photos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'time-clock-photos' 
  AND auth.role() = 'authenticated'
);
