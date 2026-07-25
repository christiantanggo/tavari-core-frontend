-- Fix RLS policies for user_roles table
-- This will resolve the 406 Not Acceptable error
-- The issue is that the existing policies use "true" which can cause PostgREST 406 errors

-- Enable RLS if not already enabled
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Allow users to view roles in their businesses" ON user_roles;
DROP POLICY IF EXISTS "Authenticated users can create user roles" ON user_roles;
DROP POLICY IF EXISTS "Authenticated users can delete user roles" ON user_roles;
DROP POLICY IF EXISTS "Users can view their own roles" ON user_roles;
DROP POLICY IF EXISTS "Users can view roles for their business" ON user_roles;
DROP POLICY IF EXISTS "Users can select their own roles" ON user_roles;
DROP POLICY IF EXISTS "Users can select roles for their business" ON user_roles;
DROP POLICY IF EXISTS "user_roles_select_policy" ON user_roles;
DROP POLICY IF EXISTS "user_roles_insert_policy" ON user_roles;
DROP POLICY IF EXISTS "user_roles_update_policy" ON user_roles;
DROP POLICY IF EXISTS "user_roles_delete_policy" ON user_roles;

-- Policy: Users can view their own roles
-- CRITICAL: Only check user_id = auth.uid(), NEVER reference business_users to avoid recursion
CREATE POLICY "Users can view roles in their businesses" ON user_roles
    FOR SELECT USING (user_id = auth.uid());

-- Policy: Users can insert roles for themselves
-- CRITICAL: Only check user_id = auth.uid(), NEVER reference business_users to avoid recursion
CREATE POLICY "Authenticated users can create user roles" ON user_roles
    FOR INSERT WITH CHECK (user_id = auth.uid());

-- Policy: Users can update their own roles
-- CRITICAL: Only check user_id = auth.uid(), NEVER reference business_users to avoid recursion
CREATE POLICY "Users can update roles for their business" ON user_roles
    FOR UPDATE 
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Policy: Users can delete their own roles
-- CRITICAL: Only check user_id = auth.uid(), NEVER reference business_users to avoid recursion
CREATE POLICY "Authenticated users can delete user roles" ON user_roles
    FOR DELETE USING (user_id = auth.uid());

-- Verify policies were created
SELECT 
    policyname,
    cmd as command,
    qual as using_expression,
    with_check as with_check_expression
FROM pg_policies 
WHERE schemaname = 'public' 
    AND tablename = 'user_roles'
ORDER BY policyname;
