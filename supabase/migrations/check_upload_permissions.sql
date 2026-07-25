-- Diagnostic query to check why upload is failing
-- Run this to see what roles the current user has

-- Check current user's roles
SELECT 
  ur.user_id,
  ur.business_id,
  ur.role,
  ur.active,
  b.name as business_name
FROM user_roles ur
LEFT JOIN businesses b ON ur.business_id = b.id
WHERE ur.user_id = auth.uid()
ORDER BY ur.active DESC, ur.role;

-- Check if user has any HR-related roles
SELECT 
  COUNT(*) as hr_role_count
FROM user_roles
WHERE user_id = auth.uid()
  AND role IN ('owner', 'manager', 'hr_admin', 'admin')
  AND active = true;

-- Test the foldername function with a sample path
SELECT 
  storage.foldername('contracts/cb982fca-cf7a-4f59-b9c7-55ca0364eddc/3985d8f0-7dcd-4690-939e-7826d6da0bbe/test.pdf') as path_array,
  (storage.foldername('contracts/cb982fca-cf7a-4f59-b9c7-55ca0364eddc/3985d8f0-7dcd-4690-939e-7826d6da0bbe/test.pdf'))[1] as business_id_from_path;










