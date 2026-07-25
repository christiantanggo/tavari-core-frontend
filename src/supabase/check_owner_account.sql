-- ============================================
-- CHECK OWNER ACCOUNT STATUS
-- ============================================
-- Run this to check if owner account exists and is accessible
-- ============================================

-- Check if owner account exists in users table
SELECT 
    id,
    email,
    first_name,
    last_name,
    full_name,
    created_at,
    updated_at
FROM users
WHERE email = 'YOUR_OWNER_EMAIL_HERE'  -- Replace with actual owner email
ORDER BY created_at DESC;

-- Check if owner account exists in auth.users
SELECT 
    id,
    email,
    email_confirmed_at,
    created_at,
    updated_at,
    last_sign_in_at,
    banned_until,
    confirmation_sent_at,
    recovery_sent_at
FROM auth.users
WHERE email = 'YOUR_OWNER_EMAIL_HERE'  -- Replace with actual owner email
ORDER BY created_at DESC;

-- Check business_users relationship
SELECT 
    bu.id,
    bu.business_id,
    bu.user_id,
    bu.role,
    bu.created_at,
    b.name as business_name
FROM business_users bu
JOIN businesses b ON bu.business_id = b.id
WHERE bu.user_id IN (
    SELECT id FROM users WHERE email = 'YOUR_OWNER_EMAIL_HERE'
)
ORDER BY bu.created_at DESC;

-- Check user_roles
SELECT 
    ur.id,
    ur.user_id,
    ur.role,
    ur.business_id,
    ur.created_at
FROM user_roles ur
WHERE ur.user_id IN (
    SELECT id FROM users WHERE email = 'YOUR_OWNER_EMAIL_HERE'
)
ORDER BY ur.created_at DESC;

