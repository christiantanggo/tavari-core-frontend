-- Test if the UPDATE function can find the user by email
-- User email: hr@tanggo.ca
-- User ID: 18390b07-6bf7-4579-9973-711f23094342

-- Test 1: Exact lookup as function does it
SELECT 
  'Function Email Lookup Test' as test,
  id,
  email,
  LOWER(TRIM('hr@tanggo.ca')) as normalized_email_input,
  LOWER(TRIM(email)) as normalized_email_stored,
  (LOWER(TRIM('hr@tanggo.ca')) = LOWER(TRIM(email))) as emails_match
FROM public.users
WHERE email = LOWER(TRIM('hr@tanggo.ca'))
LIMIT 1;

-- Test 2: What email is stored exactly?
SELECT 
  'Email Storage Check' as test,
  id,
  email,
  length(email) as email_length,
  ascii(substring(email from 1 for 1)) as first_char_ascii
FROM public.users
WHERE id = '18390b07-6bf7-4579-9973-711f23094342';

-- Test 3: Check all users with similar emails
SELECT 
  'All Similar Emails' as test,
  id,
  email,
  LOWER(email) as lower_email,
  TRIM(email) as trimmed_email,
  LOWER(TRIM(email)) as normalized
FROM public.users
WHERE email ILIKE '%hr@tanggo%'
ORDER BY created_at DESC;








