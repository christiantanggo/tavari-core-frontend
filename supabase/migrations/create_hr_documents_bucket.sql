-- Create storage bucket for HR documents (contracts, certificates, etc.)
-- This bucket stores PDFs and other documents for HR purposes

-- Step 0: Add missing columns to hr_contracts table for legacy contract uploads
DO $$
BEGIN
  -- Add storage_path column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'hr_contracts' AND column_name = 'storage_path'
  ) THEN
    ALTER TABLE hr_contracts ADD COLUMN storage_path TEXT;
  END IF;

  -- Add file_name column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'hr_contracts' AND column_name = 'file_name'
  ) THEN
    ALTER TABLE hr_contracts ADD COLUMN file_name TEXT;
  END IF;

  -- Add file_size column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'hr_contracts' AND column_name = 'file_size'
  ) THEN
    ALTER TABLE hr_contracts ADD COLUMN file_size BIGINT;
  END IF;

  -- Add uploaded_by column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'hr_contracts' AND column_name = 'uploaded_by'
  ) THEN
    ALTER TABLE hr_contracts ADD COLUMN uploaded_by UUID REFERENCES users(id);
  END IF;

  -- Add uploaded_at column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'hr_contracts' AND column_name = 'uploaded_at'
  ) THEN
    ALTER TABLE hr_contracts ADD COLUMN uploaded_at TIMESTAMPTZ;
  END IF;
END $$;

-- Step 1: Create the bucket (if it doesn't exist)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hr-documents',
  'hr-documents',
  false, -- Private bucket
  10485760, -- 10MB limit
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

-- Step 2: Drop existing policies (if any) to avoid conflicts
DROP POLICY IF EXISTS "HR can upload documents" ON storage.objects;
DROP POLICY IF EXISTS "HR can view documents" ON storage.objects;
DROP POLICY IF EXISTS "HR can delete documents" ON storage.objects;
DROP POLICY IF EXISTS "Employees can view own documents" ON storage.objects;

-- Step 3: Policy for HR to upload documents
-- Storage path format: contracts/{businessId}/{employeeId}/{timestamp}_{filename}
-- PostgreSQL arrays are 1-indexed: [1]=contracts, [2]=businessId, [3]=employeeId
CREATE POLICY "HR can upload documents"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'hr-documents' AND
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
    AND business_id::text = (storage.foldername(name))[2] -- business_id is at index 2 (1-indexed)
    AND role IN ('owner', 'manager', 'hr_admin', 'admin')
    AND active = true
  )
);

-- Step 4: Policy for HR to view documents
CREATE POLICY "HR can view documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'hr-documents' AND
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
    AND business_id::text = (storage.foldername(name))[2] -- business_id is at index 2 (1-indexed)
    AND role IN ('owner', 'manager', 'hr_admin', 'admin')
    AND active = true
  )
);

-- Step 5: Policy for employees to view their own documents
-- This allows employees to view contracts and certificates assigned to them
CREATE POLICY "Employees can view own documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'hr-documents' AND
  (
    -- Check if document is linked to employee via hr_contracts
    -- Match by storage_path or by URL containing the file path
    EXISTS (
      SELECT 1 FROM hr_contracts
      WHERE (
        storage_path = name
        OR pdf_url LIKE '%' || name || '%' 
        OR signed_pdf_url LIKE '%' || name || '%'
        OR pdf_url LIKE '%/' || name
        OR signed_pdf_url LIKE '%/' || name
      )
      AND (employee_id = auth.uid() OR employee_email = (SELECT email FROM users WHERE id = auth.uid()))
    )
    OR
    -- Check if document is linked to employee via employee_certificates
    EXISTS (
      SELECT 1 FROM employee_certificates
      WHERE certificate_file_url = name
      AND employee_id = auth.uid()
    )
  )
);

-- Step 6: Policy for HR to delete documents
CREATE POLICY "HR can delete documents"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'hr-documents' AND
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
    AND business_id::text = (storage.foldername(name))[2] -- business_id is at index 2 (1-indexed)
    AND role IN ('owner', 'manager', 'hr_admin', 'admin')
    AND active = true
  )
);

