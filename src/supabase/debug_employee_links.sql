-- Debug query to see what employees/users are linked to a business
-- Replace 'YOUR_BUSINESS_ID' with the actual business ID

-- Check business_users table
SELECT 
    bu.user_id,
    bu.business_id,
    bu.role,
    u.email,
    u.full_name,
    u.employment_status
FROM business_users bu
LEFT JOIN users u ON bu.user_id = u.id
WHERE bu.business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'  -- Replace with your business ID
ORDER BY u.full_name;

-- Check user_roles table
SELECT 
    ur.user_id,
    ur.business_id,
    ur.role,
    ur.active,
    u.email,
    u.full_name,
    u.employment_status
FROM user_roles ur
LEFT JOIN users u ON ur.user_id = u.id
WHERE ur.business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'  -- Replace with your business ID
    AND ur.active = true
ORDER BY u.full_name;

-- Count employees by table
SELECT 
    'business_users' as source_table,
    COUNT(*) as employee_count
FROM business_users
WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'

UNION ALL

SELECT 
    'user_roles' as source_table,
    COUNT(*) as employee_count
FROM user_roles
WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
    AND active = true;

-- Check if users table has a business_id column (it shouldn't, but let's verify)
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'users' 
    AND column_name LIKE '%business%';
