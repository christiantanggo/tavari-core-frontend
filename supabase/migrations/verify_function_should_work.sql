-- Verify that the UPDATE function logic should work correctly
-- This checks all the conditions the function needs

-- 1. Check that the existing user can be found by email
SELECT 
  'User Email Lookup Test' as test_name,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM public.users 
      WHERE email = LOWER(TRIM('accounting@tanggo.ca'))
    ) THEN '✅ User can be found by email'
    ELSE '❌ User NOT found by email'
  END as result,
  (SELECT id FROM public.users WHERE email = LOWER(TRIM('accounting@tanggo.ca')) LIMIT 1) as found_user_id;

-- 2. Check that contracts exist with tokens and have business_id
SELECT 
  'Contract Lookup Test' as test_name,
  COUNT(*) as contracts_with_token,
  COUNT(DISTINCT business_id) as unique_business_ids,
  COUNT(CASE WHEN business_id IS NOT NULL THEN 1 END) as contracts_with_business_id,
  CASE 
    WHEN COUNT(CASE WHEN business_id IS NOT NULL THEN 1 END) > 0 
    THEN '✅ Contracts have business_id'
    ELSE '❌ No contracts have business_id'
  END as result
FROM public.hr_contracts
WHERE employee_email = 'accounting@tanggo.ca'
  AND personal_info_token IS NOT NULL;

-- 3. Check if existing user already has business_users entry (which it should)
SELECT 
  'Existing User business_users Check' as test_name,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM public.business_users 
      WHERE user_id = 'ca2f07f6-517c-4d52-946b-8718a8576910'
        AND business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
    ) THEN '✅ User already has business_users entry'
    ELSE '❌ User does NOT have business_users entry'
  END as result;

-- 4. Check all contracts to see their state
SELECT 
  'Contract Details' as info,
  id as contract_id,
  business_id,
  employee_email,
  employee_id,
  personal_info_token IS NOT NULL as has_token,
  status,
  personal_info_submitted_at IS NOT NULL as submitted,
  created_at,
  CASE 
    WHEN employee_id = 'ca2f07f6-517c-4d52-946b-8718a8576910' THEN '✅ Linked to correct user'
    WHEN employee_id IS NULL THEN '⚠️ No employee_id'
    ELSE '❌ Linked to different user'
  END as employee_link_status
FROM public.hr_contracts
WHERE employee_email = 'accounting@tanggo.ca'
ORDER BY created_at DESC;








