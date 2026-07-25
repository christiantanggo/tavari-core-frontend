-- Fix RLS policies on business_users table to allow owners/managers to see all employees
-- This is needed for EmployeeProfiles to show all employees, not just the current user

-- 1. Check current RLS policies on business_users
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual as using_expression,
    with_check as with_check_expression
FROM pg_policies
WHERE tablename = 'business_users'
ORDER BY policyname;

-- 2. Check current policy expressions
SELECT 
    pol.polname as policy_name,
    pol.polcmd as command,
    CASE pol.polcmd
        WHEN 'r' THEN 'SELECT'
        WHEN 'a' THEN 'INSERT'
        WHEN 'w' THEN 'UPDATE'
        WHEN 'd' THEN 'DELETE'
        WHEN '*' THEN 'ALL'
    END as command_type,
    pg_get_expr(pol.polqual, pol.polrelid) as using_expression,
    pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check_expression
FROM pg_policy pol
JOIN pg_class pc ON pol.polrelid = pc.oid
WHERE pc.relname = 'business_users';

-- 3. Drop existing restrictive policies that only allow users to see themselves
-- (We'll replace them with policies that allow viewing all business members)
DROP POLICY IF EXISTS "Users can view their own business_users" ON business_users;
DROP POLICY IF EXISTS "business_users_select_policy" ON business_users;
DROP POLICY IF EXISTS "business_users_select_own" ON business_users;
DROP POLICY IF EXISTS "Users can only view their own business_users" ON business_users;

-- 4. Add a new SELECT policy that allows owners/managers/admins to view all business_users
-- This policy works alongside the existing "Users can view their own business associations" policy
-- PostgreSQL ORs multiple policies together, so both will work
-- 
-- IMPORTANT: We check the user's role in business_users table itself (self-join) but this
-- should be safe as long as we don't reference user_roles table (which causes recursion)
CREATE POLICY IF NOT EXISTS "Managers can view all business_users in their businesses"
ON business_users
FOR SELECT
USING (
    -- If user is owner/manager/admin in this business, they can see all business_users for this business
    EXISTS (
        SELECT 1 
        FROM business_users bu_check
        WHERE bu_check.business_id = business_users.business_id 
            AND bu_check.user_id = auth.uid()
            AND bu_check.role IN ('owner', 'manager', 'admin')
    )
);

-- 5. Keep INSERT, UPDATE, DELETE policies (these should already exist)
-- If they don't, you'll need to add them

-- 6. Verify the new policy
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
