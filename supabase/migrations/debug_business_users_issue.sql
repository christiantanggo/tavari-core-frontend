-- Diagnostic script to check why business_users entry is not being created
-- Run this after submitting the personal info form to see what happened
-- Replace the user_id UUID below with the actual user ID from the error message

-- User ID from logs: c6553391-c6ab-4bd8-acbd-b813a2f2399e
-- Check if user exists
SELECT 
  'User Info' as check_type,
  id,
  email,
  first_name,
  last_name,
  created_at
FROM public.users
WHERE id = 'c6553391-c6ab-4bd8-acbd-b813a2f2399e';

-- Check business_users entry
SELECT 
  'business_users' as check_type,
  user_id,
  business_id,
  role,
  created_at
FROM public.business_users
WHERE user_id = 'c6553391-c6ab-4bd8-acbd-b813a2f2399e';

-- Check user_roles entry
SELECT 
  'user_roles' as check_type,
  user_id,
  business_id,
  role,
  active,
  created_at
FROM public.user_roles
WHERE user_id = 'c6553391-c6ab-4bd8-acbd-b813a2f2399e';

-- Check contracts for this email to see what business_id should be used
SELECT 
  'Contracts' as check_type,
  id as contract_id,
  business_id,
  employee_email,
  employee_id,
  personal_info_token IS NOT NULL as has_token,
  status
FROM public.hr_contracts
WHERE employee_email = (
  SELECT email FROM public.users WHERE id = 'c6553391-c6ab-4bd8-acbd-b813a2f2399e'
)
ORDER BY created_at DESC
LIMIT 5;

-- Check if there are multiple users with similar emails
SELECT 
  'Duplicate Users Check' as check_type,
  id,
  email,
  created_at
FROM public.users
WHERE email = (
  SELECT email FROM public.users WHERE id = 'c6553391-c6ab-4bd8-acbd-b813a2f2399e'
)
ORDER BY created_at DESC;

