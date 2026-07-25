-- Check what happened with the latest user creation
-- User ID from error: bf2ff532-13d1-44bb-b93d-b96b05a5b3e8

-- 1. Check if user exists
SELECT 
  'User Info' as check_type,
  id,
  email,
  first_name,
  last_name,
  created_at
FROM public.users
WHERE id = 'bf2ff532-13d1-44bb-b93d-b96b05a5b3e8';

-- 2. Check business_users entry
SELECT 
  'business_users Check' as check_type,
  user_id,
  business_id,
  role,
  created_at
FROM public.business_users
WHERE user_id = 'bf2ff532-13d1-44bb-b93d-b96b05a5b3e8';

-- 3. Check user_roles entry
SELECT 
  'user_roles Check' as check_type,
  user_id,
  business_id,
  role,
  active,
  created_at
FROM public.user_roles
WHERE user_id = 'bf2ff532-13d1-44bb-b93d-b96b05a5b3e8';

-- 4. Find the contract that was used (most recent with personal_info_submitted)
SELECT 
  'Contract Used' as check_type,
  id as contract_id,
  business_id,
  employee_email,
  employee_id,
  personal_info_token IS NOT NULL as has_token,
  personal_info_submitted_at,
  status,
  created_at
FROM public.hr_contracts
WHERE employee_id = 'bf2ff532-13d1-44bb-b93d-b96b05a5b3e8'
   OR (employee_email = (SELECT email FROM public.users WHERE id = 'bf2ff532-13d1-44bb-b93d-b96b05a5b3e8')
       AND personal_info_submitted_at IS NOT NULL
       AND personal_info_submitted_at > NOW() - INTERVAL '10 minutes')
ORDER BY personal_info_submitted_at DESC NULLS LAST, created_at DESC
LIMIT 3;

-- 5. Check if there are multiple users with the same email
SELECT 
  'Duplicate Users' as check_type,
  id,
  email,
  created_at,
  CASE WHEN id = 'bf2ff532-13d1-44bb-b93d-b96b05a5b3e8' THEN 'THIS USER' ELSE 'OTHER USER' END as which_one
FROM public.users
WHERE email = (SELECT email FROM public.users WHERE id = 'bf2ff532-13d1-44bb-b93d-b96b05a5b3e8')
ORDER BY created_at DESC;








