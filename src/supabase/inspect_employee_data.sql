-- Inspect how employees are actually stored and linked to businesses

-- 1. Check if users table has business_id populated
SELECT 
    id,
    email,
    full_name,
    business_id,
    employment_status,
    position
FROM users
WHERE business_id IS NOT NULL
LIMIT 20;

-- 2. Check all users (with or without business_id)
SELECT 
    id,
    email,
    full_name,
    business_id,
    employment_status,
    position
FROM users
ORDER BY created_at DESC
LIMIT 20;

-- 3. Check business_users table for the specific business
SELECT 
    bu.user_id,
    bu.business_id,
    bu.role,
    u.email,
    u.full_name,
    u.employment_status,
    u.business_id as users_table_business_id
FROM business_users bu
LEFT JOIN users u ON bu.user_id = u.id
WHERE bu.business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
ORDER BY u.full_name;

-- 4. Check user_roles table for the specific business
SELECT 
    ur.user_id,
    ur.business_id,
    ur.role,
    ur.active,
    u.email,
    u.full_name,
    u.employment_status,
    u.business_id as users_table_business_id
FROM user_roles ur
LEFT JOIN users u ON ur.user_id = u.id
WHERE ur.business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
    AND ur.active = true
ORDER BY u.full_name;

-- 5. Count employees by different linking methods for this business
SELECT 
    'users.business_id' as linking_method,
    COUNT(*) as count
FROM users
WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'

UNION ALL

SELECT 
    'business_users.user_id' as linking_method,
    COUNT(DISTINCT user_id) as count
FROM business_users
WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'

UNION ALL

SELECT 
    'user_roles.user_id (active)' as linking_method,
    COUNT(DISTINCT user_id) as count
FROM user_roles
WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
    AND active = true;

-- 6. Find users that are in business_users but don't have business_id in users table
SELECT 
    bu.user_id,
    bu.business_id as bu_business_id,
    u.email,
    u.full_name,
    u.business_id as u_business_id,
    CASE 
        WHEN u.business_id IS NULL THEN 'MISSING business_id in users table'
        WHEN u.business_id != bu.business_id THEN 'MISMATCH: business_id differs'
        ELSE 'OK: business_id matches'
    END as status
FROM business_users bu
LEFT JOIN users u ON bu.user_id = u.id
WHERE bu.business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
