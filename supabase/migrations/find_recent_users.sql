-- Find users created in the last hour to see what actually happened
SELECT 
  'Recent Users' as info,
  id,
  email,
  first_name,
  last_name,
  created_at,
  updated_at
FROM public.users
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 10;

-- Check business_users for recent entries
SELECT 
  'Recent business_users' as info,
  bu.user_id,
  bu.business_id,
  bu.role,
  u.email,
  u.first_name,
  u.last_name,
  bu.created_at
FROM public.business_users bu
JOIN public.users u ON bu.user_id = u.id
WHERE bu.created_at > NOW() - INTERVAL '1 hour'
ORDER BY bu.created_at DESC
LIMIT 10;

-- Check contracts updated in last hour (personal_info_submitted)
SELECT 
  'Recent Contract Submissions' as info,
  id as contract_id,
  business_id,
  employee_email,
  employee_id,
  personal_info_token IS NOT NULL as has_token,
  personal_info_submitted_at,
  status,
  created_at
FROM public.hr_contracts
WHERE personal_info_submitted_at > NOW() - INTERVAL '1 hour'
ORDER BY personal_info_submitted_at DESC
LIMIT 5;








