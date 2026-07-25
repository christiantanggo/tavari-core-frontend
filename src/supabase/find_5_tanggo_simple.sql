-- ============================================
-- SIMPLE SEARCH FOR 5@tanggo.ca
-- ============================================
-- This will find the account no matter what

-- Search users table - ANY variation
SELECT 
    id,
    email,
    first_name,
    last_name,
    full_name,
    created_at
FROM users
WHERE email ILIKE '%tanggo%'
   OR email ILIKE '%5@%'
   OR email LIKE '%tanggo%'
   OR email LIKE '%5@%'
ORDER BY created_at DESC;

-- Search auth.users table - ANY variation
SELECT 
    id,
    email,
    email_confirmed_at,
    created_at,
    last_sign_in_at
FROM auth.users
WHERE email ILIKE '%tanggo%'
   OR email ILIKE '%5@%'
   OR email LIKE '%tanggo%'
   OR email LIKE '%5@%'
ORDER BY created_at DESC;

-- Get ALL users with '5' or 'tanggo' in email (very broad)
SELECT 
    id,
    email,
    first_name,
    last_name,
    created_at
FROM users
WHERE email LIKE '%5%'
   OR email LIKE '%tanggo%'
ORDER BY email;


