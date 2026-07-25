-- Add certificate_file_url column to employee_certificates table
-- This will store the Supabase Storage URL for the uploaded certificate file

-- Add column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employee_certificates' AND column_name = 'certificate_file_url'
  ) THEN
    ALTER TABLE employee_certificates ADD COLUMN certificate_file_url TEXT;
  END IF;
END $$;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_employee_certificates_file_url 
ON employee_certificates(certificate_file_url) 
WHERE certificate_file_url IS NOT NULL;

-- Create Supabase Storage bucket for employee certificates
-- Note: This needs to be run in Supabase Dashboard or via API
-- The bucket will be created with the name 'employee-certificates'
-- RLS policies will be set up to restrict access to managers only

-- Storage bucket creation (run this in Supabase SQL Editor or via API):
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES (
--   'employee-certificates',
--   'employee-certificates',
--   false, -- Private bucket
--   10485760, -- 10MB file size limit
--   ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/jpg']
-- )
-- ON CONFLICT (id) DO NOTHING;

-- RLS Policy: Only managers/owners/admins can upload files
CREATE POLICY "Managers can upload certificate files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'employee-certificates' AND
  EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN users u ON ur.user_id = u.id
    WHERE ur.user_id = auth.uid()
    AND ur.active = true
    AND ur.role IN ('manager', 'owner', 'admin')
  )
);

-- RLS Policy: Only managers/owners/admins can view files
CREATE POLICY "Managers can view certificate files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'employee-certificates' AND
  EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN users u ON ur.user_id = u.id
    WHERE ur.user_id = auth.uid()
    AND ur.active = true
    AND ur.role IN ('manager', 'owner', 'admin')
  )
);

-- RLS Policy: Only managers/owners/admins can delete files
CREATE POLICY "Managers can delete certificate files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'employee-certificates' AND
  EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN users u ON ur.user_id = u.id
    WHERE ur.user_id = auth.uid()
    AND ur.active = true
    AND ur.role IN ('manager', 'owner', 'admin')
  )
);

-- Add comment to column
COMMENT ON COLUMN employee_certificates.certificate_file_url IS 'Supabase Storage URL for the uploaded certificate document. Access requires manager PIN verification.';


















