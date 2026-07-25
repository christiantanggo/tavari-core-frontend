-- Fix RLS policies for ingredients table
-- This ensures users can only access ingredients for their business
-- Drops existing policies and recreates them with correct syntax

-- Enable RLS on ingredients table (if not already enabled)
ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "ingredients_select_policy" ON ingredients;
DROP POLICY IF EXISTS "ingredients_insert_policy" ON ingredients;
DROP POLICY IF EXISTS "ingredients_update_policy" ON ingredients;
DROP POLICY IF EXISTS "ingredients_delete_policy" ON ingredients;
DROP POLICY IF EXISTS "Users can view ingredients for their business" ON ingredients;
DROP POLICY IF EXISTS "Users can insert ingredients for their business" ON ingredients;
DROP POLICY IF EXISTS "Users can update ingredients for their business" ON ingredients;
DROP POLICY IF EXISTS "Users can delete ingredients for their business" ON ingredients;

-- Policy: Users can view ingredients for their business
CREATE POLICY "Users can view ingredients for their business" ON ingredients
    FOR SELECT USING (
        business_id IN (
            SELECT business_id FROM business_users 
            WHERE user_id = auth.uid()
        )
    );

-- Policy: Users can insert ingredients for their business
-- WITH CHECK validates the row being inserted
CREATE POLICY "Users can insert ingredients for their business" ON ingredients
    FOR INSERT WITH CHECK (
        business_id IN (
            SELECT business_id FROM business_users 
            WHERE user_id = auth.uid()
        )
    );

-- Policy: Users can update ingredients for their business
-- USING clause checks existing rows, WITH CHECK validates updates
CREATE POLICY "Users can update ingredients for their business" ON ingredients
    FOR UPDATE 
    USING (
        business_id IN (
            SELECT business_id FROM business_users 
            WHERE user_id = auth.uid()
        )
    )
    WITH CHECK (
        business_id IN (
            SELECT business_id FROM business_users 
            WHERE user_id = auth.uid()
        )
    );

-- Policy: Users can delete ingredients for their business
CREATE POLICY "Users can delete ingredients for their business" ON ingredients
    FOR DELETE USING (
        business_id IN (
            SELECT business_id FROM business_users 
            WHERE user_id = auth.uid()
        )
    );
