-- Check the user that was actually created/updated from the contract
-- User ID: 18390b07-6bf7-4579-9973-711f23094342

-- 1. Check user exists
SELECT 
  'User Info' as check_type,
  id,
  email,
  first_name,
  last_name,
  created_at,
  updated_at
FROM public.users
WHERE id = '18390b07-6bf7-4579-9973-711f23094342';

-- 2. Check business_users entry
SELECT 
  'business_users Check' as check_type,
  user_id,
  business_id,
  role,
  created_at
FROM public.business_users
WHERE user_id = '18390b07-6bf7-4579-9973-711f23094342';

-- 3. Check user_roles entry
SELECT 
  'user_roles Check' as check_type,
  user_id,
  business_id,
  role,
  active,
  created_at
FROM public.user_roles
WHERE user_id = '18390b07-6bf7-4579-9973-711f23094342';

-- 4. Check all users with this email to see if there are duplicates
SELECT 
  'All Users with Email' as check_type,
  id,
  email,
  first_name,
  last_name,
  created_at
FROM public.users
WHERE email = 'hr@tanggo.ca'
ORDER BY created_at DESC;








