-- Diagnose why the UPDATE function isn't finding existing users by email
-- This will help identify email matching issues

-- Check all users with the email (case variations)
SELECT 
  'All Users with Email' as check_type,
  id,
  email,
  LOWER(TRIM(email)) as normalized_email,
  first_name,
  last_name,
  created_at,
  personal_info_token IS NOT NULL as has_token
FROM public.users
WHERE LOWER(email) LIKE '%accounting%tanggo%' 
   OR email = 'accounting@tanggo.ca'
   OR LOWER(TRIM(email)) = LOWER(TRIM('accounting@tanggo.ca'))
ORDER BY created_at DESC;

-- Check the contract to see what email is stored there
SELECT 
  'Contract Email Info' as check_type,
  id as contract_id,
  business_id,
  employee_email,
  LOWER(TRIM(employee_email)) as normalized_contract_email,
  employee_id,
  personal_info_token IS NOT NULL as has_token,
  personal_info_submitted_at IS NOT NULL as personal_info_submitted,
  status,
  created_at
FROM public.hr_contracts
WHERE employee_email LIKE '%accounting%tanggo%' 
   OR employee_email = 'accounting@tanggo.ca'
   OR LOWER(TRIM(employee_email)) = LOWER(TRIM('accounting@tanggo.ca'))
ORDER BY created_at DESC
LIMIT 5;

-- Test the exact email matching logic used in the function
SELECT 
  'Email Match Test' as check_type,
  'Parameter email' as source,
  'accounting@tanggo.ca' as test_email,
  LOWER(TRIM('accounting@tanggo.ca')) as normalized,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM public.users 
      WHERE email = LOWER(TRIM('accounting@tanggo.ca'))
    ) THEN '✅ Match found'
    ELSE '❌ No match'
  END as match_result,
  (SELECT id FROM public.users WHERE email = LOWER(TRIM('accounting@tanggo.ca')) LIMIT 1) as matched_user_id;

-- Check what the existing user's email looks like
SELECT 
  'Existing User Email' as check_type,
  id,
  email,
  LOWER(TRIM(email)) as normalized,
  email = 'accounting@tanggo.ca' as exact_match,
  LOWER(TRIM(email)) = LOWER(TRIM('accounting@tanggo.ca')) as normalized_match
FROM public.users
WHERE id = 'ca2f07f6-517c-4d52-946b-8718a8576910';








