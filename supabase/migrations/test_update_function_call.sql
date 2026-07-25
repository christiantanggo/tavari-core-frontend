-- Test the UPDATE function to see what happens when called
-- This simulates what the frontend does
-- WARNING: This will actually call the function - use a test token/email

-- First, find a contract with a personal_info_token to test with
SELECT 
  'Test Contract' as info,
  id as contract_id,
  business_id,
  employee_email,
  employee_id,
  personal_info_token,
  status,
  personal_info_submitted_at IS NOT NULL as already_submitted
FROM public.hr_contracts
WHERE employee_email = 'accounting@tanggo.ca'
  AND personal_info_token IS NOT NULL
  AND personal_info_submitted_at IS NULL  -- Not yet submitted
ORDER BY created_at DESC
LIMIT 1;

-- If you want to test the function, uncomment below and replace TOKEN_HERE with actual token
-- Note: This will actually run the function, so be careful!
/*
SELECT update_user_personal_info_complete(
  'TOKEN_HERE'::TEXT,  -- Replace with actual personal_info_token
  'accounting@tanggo.ca'::TEXT,  -- Email from form
  'Accounting'::TEXT,  -- First name
  'Test'::TEXT,  -- Last name
  NULL::TEXT,  -- SIN (optional)
  NULL::DATE,  -- Birth date (optional)
  NULL::TEXT,  -- Address line 1
  NULL::TEXT,  -- Address line 2
  NULL::TEXT,  -- City
  NULL::TEXT,  -- State
  NULL::TEXT,  -- Postal code
  NULL::TEXT,  -- Phone
  NULL::TEXT,  -- Emergency contact name
  NULL::TEXT,  -- Emergency contact phone
  NULL::TEXT,  -- Emergency contact relationship
  NULL::TEXT,  -- Hashed password (optional)
  NULL::TEXT,  -- Hashed pin (optional)
  'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'::UUID  -- Business ID
) as returned_user_id;
*/








