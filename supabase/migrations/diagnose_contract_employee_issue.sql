-- Diagnostic query to check contract and employee status
-- Run this to see what happened with a specific contract

-- Replace 'CONTRACT_ID_HERE' with the actual contract ID
-- Or replace 'EMPLOYEE_EMAIL_HERE' with the employee email

-- 1. Check contract status
SELECT 
  id,
  business_id,
  employee_email,
  employee_first_name,
  employee_last_name,
  status,
  signed_at,
  authorized_representative_signed_at,
  personal_info_submitted_at,
  employee_id,
  created_at
FROM hr_contracts
WHERE employee_email = 'EMPLOYEE_EMAIL_HERE'  -- Replace with actual email
  OR id = 'CONTRACT_ID_HERE'  -- Or replace with contract ID
ORDER BY created_at DESC
LIMIT 5;

-- 2. Check if user exists
SELECT 
  id,
  email,
  first_name,
  last_name,
  full_name,
  employment_status,
  created_at
FROM users
WHERE email = 'EMPLOYEE_EMAIL_HERE'  -- Replace with actual email
LIMIT 1;

-- 3. Check if user is linked to business via user_roles
SELECT 
  ur.id,
  ur.user_id,
  ur.business_id,
  ur.role,
  ur.active,
  u.email,
  u.first_name,
  u.last_name
FROM user_roles ur
JOIN users u ON u.id = ur.user_id
WHERE u.email = 'EMPLOYEE_EMAIL_HERE'  -- Replace with actual email
  OR ur.user_id = (SELECT id FROM users WHERE email = 'EMPLOYEE_EMAIL_HERE' LIMIT 1)
LIMIT 5;

-- 4. Check all signed contracts without employee_id
SELECT 
  id,
  business_id,
  employee_email,
  employee_first_name,
  employee_last_name,
  status,
  signed_at,
  authorized_representative_signed_at,
  employee_id,
  personal_info_submitted_at
FROM hr_contracts
WHERE status = 'signed'
  AND (employee_id IS NULL OR employee_id NOT IN (SELECT id FROM users))
ORDER BY signed_at DESC
LIMIT 10;

-- 5. Check users with personal info but not linked to any business
SELECT 
  u.id,
  u.email,
  u.first_name,
  u.last_name,
  u.sin,
  u.address_line1,
  u.emergency_contact_name,
  u.created_at,
  COUNT(ur.id) as business_links_count
FROM users u
LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.active = true
WHERE u.sin IS NOT NULL 
  OR u.address_line1 IS NOT NULL
  OR u.emergency_contact_name IS NOT NULL
GROUP BY u.id, u.email, u.first_name, u.last_name, u.sin, u.address_line1, u.emergency_contact_name, u.created_at
HAVING COUNT(ur.id) = 0
ORDER BY u.created_at DESC
LIMIT 10;












