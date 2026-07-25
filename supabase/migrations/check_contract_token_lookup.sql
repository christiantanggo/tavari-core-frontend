-- Check if the contract lookup in the UPDATE function would work
-- This simulates what the function does at the beginning

-- Find contracts with personal_info_token for accounting@tanggo.ca
SELECT 
  'Contracts with Token' as check_type,
  id as contract_id,
  business_id,
  employee_email,
  employee_id,
  personal_info_token IS NOT NULL as has_token,
  LENGTH(personal_info_token) as token_length,
  status,
  personal_info_submitted_at IS NOT NULL as personal_info_submitted,
  created_at
FROM public.hr_contracts
WHERE employee_email = 'accounting@tanggo.ca'
  AND personal_info_token IS NOT NULL
ORDER BY created_at DESC;

-- Check the most recent contract (which would be used in the form)
SELECT 
  'Most Recent Contract' as check_type,
  id as contract_id,
  business_id,
  employee_email,
  employee_id,
  personal_info_token,
  status,
  personal_info_submitted_at,
  created_at
FROM public.hr_contracts
WHERE employee_email = 'accounting@tanggo.ca'
ORDER BY created_at DESC
LIMIT 1;

-- Simulate the exact lookup the function does:
-- SELECT id, business_id, employee_email FROM hr_contracts WHERE personal_info_token = ?
-- (We can't run this without the actual token, but we can verify tokens exist)
SELECT 
  'Token Verification' as check_type,
  COUNT(*) as contracts_with_tokens,
  COUNT(DISTINCT employee_email) as unique_emails,
  COUNT(DISTINCT business_id) as unique_businesses
FROM public.hr_contracts
WHERE employee_email = 'accounting@tanggo.ca'
  AND personal_info_token IS NOT NULL;








