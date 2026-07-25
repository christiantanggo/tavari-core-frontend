-- Quick check for user: c6553391-c6ab-4bd8-acbd-b813a2f2399e
-- Run this to see if business_users entry exists

SELECT 
  u.id as user_id,
  u.email,
  u.first_name,
  u.last_name,
  bu.business_id,
  bu.role as business_role,
  ur.role as user_role,
  ur.active
FROM public.users u
LEFT JOIN public.business_users bu ON u.id = bu.user_id
LEFT JOIN public.user_roles ur ON u.id = ur.user_id
WHERE u.id = 'c6553391-c6ab-4bd8-acbd-b813a2f2399e';

-- Also check if there's a contract for this user's email
SELECT 
  hc.id as contract_id,
  hc.business_id,
  hc.employee_email,
  hc.employee_id,
  hc.status,
  hc.personal_info_token IS NOT NULL as has_token
FROM public.hr_contracts hc
WHERE hc.employee_email = (
  SELECT email FROM public.users WHERE id = 'c6553391-c6ab-4bd8-acbd-b813a2f2399e'
)
ORDER BY hc.created_at DESC
LIMIT 3;








