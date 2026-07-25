-- Debug the actual query that EmployeeProfiles is running
-- Let's test what the RLS policies are actually returning

-- 1. Test the business_users query directly (this is what EmployeeProfiles runs)
SELECT 
    user_id, 
    role, 
    business_id,
    'business_users query' as source
FROM business_users 
WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
ORDER BY user_id;

-- 2. Test the user_roles query (fallback)
SELECT 
    user_id, 
    role, 
    business_id,
    active,
    'user_roles query' as source
FROM user_roles 
WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
ORDER BY user_id;

-- 3. Test the function directly
SELECT user_has_elevated_role_in_business('cb982fca-cf7a-4f59-b9c7-55ca0364eddc') as has_elevated_role;

-- 4. Check what user_id we're testing with
SELECT auth.uid() as current_user_id;

-- 5. Check if the current user has elevated role in business_users
SELECT 
    user_id,
    role,
    business_id
FROM business_users 
WHERE user_id = auth.uid() 
    AND business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
    AND role IN ('owner', 'manager', 'admin');

-- 6. Count total business_users for this business (should be 12)
SELECT COUNT(*) as total_business_users
FROM business_users 
WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';

-- 7. Show all business_users for this business (without RLS - run as superuser if possible)
-- This will show what SHOULD be returned
SELECT 
    user_id, 
    role, 
    business_id,
    'all records' as source
FROM business_users 
WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
ORDER BY user_id;
