-- Fix infinite recursion in business_users RLS policies
-- CRITICAL: business_users policies must NOT reference business_users itself

-- First, let's see what policies exist
SELECT 
    policyname,
    cmd as command,
    qual as using_expression,
    with_check as with_check_expression
FROM pg_policies 
WHERE schemaname = 'public' 
    AND tablename = 'business_users'
ORDER BY policyname;

-- Drop ALL existing policies on business_users to start fresh
DROP POLICY IF EXISTS "business_users_select_policy" ON business_users;
DROP POLICY IF EXISTS "business_users_insert_policy" ON business_users;
DROP POLICY IF EXISTS "business_users_update_policy" ON business_users;
DROP POLICY IF EXISTS "business_users_delete_policy" ON business_users;
DROP POLICY IF EXISTS "Users can view their own business associations" ON business_users;
DROP POLICY IF EXISTS "Users can insert business associations" ON business_users;
DROP POLICY IF EXISTS "Users can update business associations" ON business_users;
DROP POLICY IF EXISTS "Users can delete business associations" ON business_users;
DROP POLICY IF EXISTS "Users can view their business associations" ON business_users;
DROP POLICY IF EXISTS "Users can view business relationships in their businesses" ON business_users;
DROP POLICY IF EXISTS "Authenticated users can create business relationships" ON business_users;
DROP POLICY IF EXISTS "Authenticated users can delete business relationships" ON business_users;
DROP POLICY IF EXISTS "Allow users to view their business associations" ON business_users;
DROP POLICY IF EXISTS "Allow users to insert business associations" ON business_users;
DROP POLICY IF EXISTS "Allow users to update business associations" ON business_users;
DROP POLICY IF EXISTS "Allow users to delete business associations" ON business_users;

-- Create NON-RECURSIVE policies
-- CRITICAL: Only check user_id = auth.uid(), NEVER reference business_users or user_roles tables
-- This breaks the infinite recursion cycle

-- Users can view their own business associations
-- Simple policy: only check if user_id matches auth.uid()
-- DO NOT reference user_roles or business_users tables to avoid recursion
CREATE POLICY "Users can view their own business associations" ON business_users
    FOR SELECT USING (user_id = auth.uid());

-- Users can insert associations for themselves
CREATE POLICY "Users can insert their own business associations" ON business_users
    FOR INSERT WITH CHECK (user_id = auth.uid());

-- Users can update their own associations
CREATE POLICY "Users can update their own business associations" ON business_users
    FOR UPDATE 
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Users can delete their own associations
CREATE POLICY "Users can delete their own business associations" ON business_users
    FOR DELETE USING (user_id = auth.uid());

-- Verify the new policies
SELECT 
    policyname,
    cmd as command,
    qual as using_expression,
    with_check as with_check_expression
FROM pg_policies 
WHERE schemaname = 'public' 
    AND tablename = 'business_users'
ORDER BY policyname;