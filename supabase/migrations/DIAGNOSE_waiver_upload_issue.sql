-- Diagnostic query to check why waiver upload is failing
-- Run this to see what roles the current user has

-- Check current user's roles for the business
SELECT 
  ur.user_id,
  ur.business_id,
  ur.role,
  ur.active,
  b.name as business_name,
  b.id::text as business_id_text
FROM user_roles ur
LEFT JOIN businesses b ON ur.business_id = b.id
WHERE ur.user_id = auth.uid()
  AND ur.active = true
ORDER BY ur.role;

-- Check if user has manager/owner/admin role
SELECT 
  COUNT(*) as manager_role_count
FROM user_roles
WHERE user_id = auth.uid()
  AND role IN ('owner', 'admin', 'manager')
  AND active = true;

-- Test the foldername function with the actual path structure
SELECT 
  'paper-waivers/cb982fca-cf7a-4f59-b9c7-55ca0364eddc/test.pdf' as test_path,
  storage.foldername('paper-waivers/cb982fca-cf7a-4f59-b9c7-55ca0364eddc/test.pdf') as path_array,
  (storage.foldername('paper-waivers/cb982fca-cf7a-4f59-b9c7-55ca0364eddc/test.pdf'))[1] as first_folder,
  (storage.foldername('paper-waivers/cb982fca-cf7a-4f59-b9c7-55ca0364eddc/test.pdf'))[2] as second_folder,
  (storage.foldername('paper-waivers/cb982fca-cf7a-4f59-b9c7-55ca0364eddc/test.pdf'))[2] IN (
    SELECT business_id::text 
    FROM user_roles 
    WHERE user_id = auth.uid() 
      AND role IN ('owner', 'admin', 'manager')
      AND active = true
  ) as matches_business_id;

-- Test if the policy condition would pass
SELECT 
  bucket_id = 'waivers' as bucket_check,
  (storage.foldername('paper-waivers/cb982fca-cf7a-4f59-b9c7-55ca0364eddc/test.pdf'))[1] = 'paper-waivers' as first_folder_check,
  (storage.foldername('paper-waivers/cb982fca-cf7a-4f59-b9c7-55ca0364eddc/test.pdf'))[2] as business_id_from_path,
  EXISTS (
    SELECT 1 
    FROM user_roles 
    WHERE user_id = auth.uid() 
      AND business_id::text = (storage.foldername('paper-waivers/cb982fca-cf7a-4f59-b9c7-55ca0364eddc/test.pdf'))[2]
      AND role IN ('owner', 'admin', 'manager')
      AND active = true
  ) as has_permission
FROM storage.buckets
WHERE id = 'waivers';

-- Check current authenticated user
SELECT 
  auth.uid() as current_user_id,
  auth.email() as current_user_email;





