-- Fix the upload policy for hr-documents bucket
-- PostgreSQL arrays are 1-indexed, so business_id is at [2], not [1]

DROP POLICY IF EXISTS "HR can upload documents" ON storage.objects;

-- Policy with correct array index: business_id is at [2] (1-indexed array)
-- Path format: contracts/{businessId}/{employeeId}/{filename}
-- Array: [1]=contracts, [2]=businessId, [3]=employeeId
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

