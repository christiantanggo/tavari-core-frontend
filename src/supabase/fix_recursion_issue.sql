-- Fix the infinite recursion issue in business_users RLS policy
-- The self-join in the policy is causing recursion

-- 1. First, drop the problematic policy
DROP POLICY IF EXISTS "Managers can view all business_users in their businesses" ON business_users;

-- 2. Check current policies
SELECT 
    pol.polname as policy_name,
    CASE pol.polcmd
        WHEN 'r' THEN 'SELECT'
        WHEN 'a' THEN 'INSERT'
        WHEN 'w' THEN 'UPDATE'
        WHEN 'd' THEN 'DELETE'
    END as command_type,
    pg_get_expr(pol.polqual, pol.polrelid) as using_expression
FROM pg_policy pol
JOIN pg_class pc ON pol.polrelid = pc.oid
WHERE pc.relname = 'business_users'
ORDER BY pol.polname;

-- 3. Alternative approach: Use a function to check user role
-- This avoids recursion by using a separate function
CREATE OR REPLACE FUNCTION user_has_elevated_role_in_business(business_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    -- Check if current user has owner/manager/admin role in the given business
    RETURN EXISTS (
        SELECT 1 
        FROM business_users 
        WHERE business_id = business_uuid 
            AND user_id = auth.uid()
            AND role IN ('owner', 'manager', 'admin')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create a new policy using the function (this should avoid recursion)
CREATE POLICY "Managers can view all business_users in their businesses"
ON business_users
FOR SELECT
USING (
    -- Allow if viewing own record (existing behavior)
    user_id = auth.uid()
    -- OR if user has elevated role in this business (using function to avoid recursion)
    OR user_has_elevated_role_in_business(business_id)
);

-- 5. Verify the new policy
SELECT 
    pol.polname as policy_name,
    CASE pol.polcmd
        WHEN 'r' THEN 'SELECT'
        WHEN 'a' THEN 'INSERT'
        WHEN 'w' THEN 'UPDATE'
        WHEN 'd' THEN 'DELETE'
    END as command_type,
    pg_get_expr(pol.polqual, pol.polrelid) as using_expression
FROM pg_policy pol
JOIN pg_class pc ON pol.polrelid = pc.oid
WHERE pc.relname = 'business_users'
    AND pol.polname = 'Managers can view all business_users in their businesses';
