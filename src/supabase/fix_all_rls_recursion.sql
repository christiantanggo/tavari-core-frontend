-- COMPLETE FIX FOR ALL RLS RECURSION ISSUES
-- Run this to fix business_users and user_roles policies simultaneously

-- ============================================================================
-- PART 1: Fix business_users table (CRITICAL - must be non-recursive)
-- ============================================================================

-- Drop ALL existing policies on business_users
DROP POLICY IF EXISTS "business_users_select_policy" ON business_users;
DROP POLICY IF EXISTS "business_users_insert_policy" ON business_users;
DROP POLICY IF EXISTS "business_users_update_policy" ON business_users;
DROP POLICY IF EXISTS "business_users_delete_policy" ON business_users;
DROP POLICY IF EXISTS "Users can view their own business associations" ON business_users;
DROP POLICY IF EXISTS "Users can insert their own business associations" ON business_users;
DROP POLICY IF EXISTS "Users can insert business associations" ON business_users;
DROP POLICY IF EXISTS "Users can update their own business associations" ON business_users;
DROP POLICY IF EXISTS "Users can update business associations" ON business_users;
DROP POLICY IF EXISTS "Users can delete their own business associations" ON business_users;
DROP POLICY IF EXISTS "Users can delete business associations" ON business_users;
DROP POLICY IF EXISTS "Users can view their business associations" ON business_users;
DROP POLICY IF EXISTS "Users can view business relationships in their businesses" ON business_users;
DROP POLICY IF EXISTS "Authenticated users can create business relationships" ON business_users;
DROP POLICY IF EXISTS "Authenticated users can delete business relationships" ON business_users;
DROP POLICY IF EXISTS "Allow users to view their business associations" ON business_users;
DROP POLICY IF EXISTS "Allow users to insert business associations" ON business_users;
DROP POLICY IF EXISTS "Allow users to update business associations" ON business_users;
DROP POLICY IF EXISTS "Allow users to delete business associations" ON business_users;

-- Create NON-RECURSIVE policies for business_users
-- CRITICAL: Only check user_id = auth.uid(), NEVER reference business_users or user_roles tables
CREATE POLICY "Users can view their own business associations" ON business_users
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own business associations" ON business_users
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own business associations" ON business_users
    FOR UPDATE 
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own business associations" ON business_users
    FOR DELETE USING (user_id = auth.uid());

-- ============================================================================
-- PART 2: Fix user_roles table (CRITICAL - must be non-recursive)
-- ============================================================================

-- Drop ALL existing policies on user_roles
DROP POLICY IF EXISTS "Allow users to view roles in their businesses" ON user_roles;
DROP POLICY IF EXISTS "Users can view roles in their businesses" ON user_roles;
DROP POLICY IF EXISTS "Authenticated users can create user roles" ON user_roles;
DROP POLICY IF EXISTS "Users can update roles for their business" ON user_roles;
DROP POLICY IF EXISTS "Authenticated users can delete user roles" ON user_roles;
DROP POLICY IF EXISTS "user_roles_select_policy" ON user_roles;
DROP POLICY IF EXISTS "user_roles_insert_policy" ON user_roles;
DROP POLICY IF EXISTS "user_roles_update_policy" ON user_roles;
DROP POLICY IF EXISTS "user_roles_delete_policy" ON user_roles;

-- Create NON-RECURSIVE policies for user_roles
-- CRITICAL: Only check user_id = auth.uid(), NEVER reference business_users to avoid recursion
CREATE POLICY "Users can view roles in their businesses" ON user_roles
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Authenticated users can create user roles" ON user_roles
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update roles for their business" ON user_roles
    FOR UPDATE 
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Authenticated users can delete user roles" ON user_roles
    FOR DELETE USING (user_id = auth.uid());

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Verify business_users policies
SELECT 
    'business_users' as table_name,
    policyname,
    cmd as command
FROM pg_policies 
WHERE schemaname = 'public' 
    AND tablename = 'business_users'
ORDER BY policyname;

-- Verify user_roles policies
SELECT 
    'user_roles' as table_name,
    policyname,
    cmd as command
FROM pg_policies 
WHERE schemaname = 'public' 
    AND tablename = 'user_roles'
ORDER BY policyname;
