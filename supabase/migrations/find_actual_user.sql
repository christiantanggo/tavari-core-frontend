-- Find the actual user that was created from the personal info form
-- This will help us identify the correct user ID

-- First, find users created recently (last 10 minutes) - adjust time as needed
SELECT 
  'Recent Users' as check_type,
  id,
  email,
  first_name,
  last_name,
  created_at,
  personal_info_token IS NOT NULL as has_token
FROM public.users
WHERE created_at > NOW() - INTERVAL '30 minutes'
ORDER BY created_at DESC
LIMIT 10;

-- Also check for users with the email from the contract
-- Replace 'accounting@tanggo.ca' with the actual email if different
SELECT 
  'Users by Email' as check_type,
  id,
  email,
  first_name,
  last_name,
  created_at
FROM public.users
WHERE email LIKE '%accounting%tanggo%' OR email = 'accounting@tanggo.ca'
ORDER BY created_at DESC;

-- Check what contracts exist and their employee_id
SELECT 
  'Contracts with Employee IDs' as check_type,
  id as contract_id,
  business_id,
  employee_email,
  employee_id,
  status,
  personal_info_submitted_at IS NOT NULL as personal_info_submitted,
  created_at
FROM public.hr_contracts
WHERE employee_email LIKE '%accounting%tanggo%' OR employee_email = 'accounting@tanggo.ca'
ORDER BY created_at DESC
LIMIT 5;

-- Check business_users for any recent entries
SELECT 
  'Recent business_users' as check_type,
  bu.user_id,
  bu.business_id,
  bu.role,
  u.email,
  u.first_name,
  u.last_name,
  bu.created_at
FROM public.business_users bu
JOIN public.users u ON bu.user_id = u.id
WHERE bu.created_at > NOW() - INTERVAL '30 minutes'
ORDER BY bu.created_at DESC
LIMIT 10;








