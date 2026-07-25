-- ============================================
-- FIND OWNER ACCOUNT: 5@tanggo.ca
-- ============================================
-- This script searches for the owner account with various email formats
-- ============================================

-- Search users table with multiple patterns
SELECT 
    id,
    email,
    first_name,
    last_name,
    full_name,
    created_at,
    updated_at,
    LENGTH(email) as email_length,
    TRIM(email) as email_trimmed,
    LOWER(TRIM(email)) as email_normalized
FROM users
WHERE 
    email = '5@tanggo.ca'
    OR LOWER(email) = '5@tanggo.ca'
    OR TRIM(email) = '5@tanggo.ca'
    OR LOWER(TRIM(email)) = '5@tanggo.ca'
    OR email LIKE '%5@tanggo.ca%'
    OR email LIKE '%tanggo%'
ORDER BY created_at DESC;

-- Search auth.users table
SELECT 
    id,
    email,
    email_confirmed_at,
    created_at,
    updated_at,
    last_sign_in_at,
    banned_until,
    LENGTH(email) as email_length,
    TRIM(email) as email_trimmed,
    LOWER(TRIM(email)) as email_normalized
FROM auth.users
WHERE 
    email = '5@tanggo.ca'
    OR LOWER(email) = '5@tanggo.ca'
    OR TRIM(email) = '5@tanggo.ca'
    OR LOWER(TRIM(email)) = '5@tanggo.ca'
    OR email LIKE '%5@tanggo.ca%'
    OR email LIKE '%tanggo%'
ORDER BY created_at DESC;

-- Check business_users for this user
SELECT 
    bu.id,
    bu.business_id,
    bu.user_id,
    bu.role,
    bu.created_at,
    b.name as business_name,
    u.email as user_email
FROM business_users bu
JOIN businesses b ON bu.business_id = b.id
JOIN users u ON bu.user_id = u.id
WHERE 
    u.email = '5@tanggo.ca'
    OR LOWER(u.email) = '5@tanggo.ca'
    OR LOWER(TRIM(u.email)) = '5@tanggo.ca'
    OR u.email LIKE '%5@tanggo.ca%'
ORDER BY bu.created_at DESC;

-- Check user_roles
SELECT 
    ur.id,
    ur.user_id,
    ur.role,
    ur.business_id,
    ur.created_at,
    u.email as user_email
FROM user_roles ur
JOIN users u ON ur.user_id = u.id
WHERE 
    u.email = '5@tanggo.ca'
    OR LOWER(u.email) = '5@tanggo.ca'
    OR LOWER(TRIM(u.email)) = '5@tanggo.ca'
    OR u.email LIKE '%5@tanggo.ca%'
ORDER BY ur.created_at DESC;


