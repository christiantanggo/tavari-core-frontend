-- Fix RLS policies for module_onboarding_status table
-- This resolves 406 Not Acceptable errors by using SECURITY DEFINER functions
-- to avoid RLS recursion issues when checking user_roles/business_users tables

-- Step 1: Create helper functions to check business access (bypasses RLS)
CREATE OR REPLACE FUNCTION check_user_business_access(
    p_business_id uuid,
    p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
    -- Check user_roles table first (if it exists)
    IF EXISTS (
        SELECT 1 FROM user_roles
        WHERE business_id = p_business_id
          AND user_id = p_user_id
          AND (active = true OR active IS NULL)
    ) THEN
        RETURN true;
    END IF;
    
    -- Fallback to business_users table
    IF EXISTS (
        SELECT 1 FROM business_users
        WHERE business_id = p_business_id
          AND user_id = p_user_id
    ) THEN
        RETURN true;
    END IF;
    
    RETURN false;
END;
$$;

-- Helper function to check if user has elevated role (owner/manager/admin)
CREATE OR REPLACE FUNCTION check_user_elevated_role(
    p_business_id uuid,
    p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
    -- Check user_roles table first
    IF EXISTS (
        SELECT 1 FROM user_roles
        WHERE business_id = p_business_id
          AND user_id = p_user_id
          AND role IN ('owner', 'manager', 'admin')
          AND (active = true OR active IS NULL)
    ) THEN
        RETURN true;
    END IF;
    
    -- Fallback to business_users table
    IF EXISTS (
        SELECT 1 FROM business_users
        WHERE business_id = p_business_id
          AND user_id = p_user_id
          AND role IN ('owner', 'manager', 'admin')
    ) THEN
        RETURN true;
    END IF;
    
    RETURN false;
END;
$$;

-- Step 2: Drop ALL existing policies (including duplicates)
DROP POLICY IF EXISTS "Users can view onboarding status for their business" ON module_onboarding_status;
DROP POLICY IF EXISTS "Owners and managers can manage onboarding status" ON module_onboarding_status;
DROP POLICY IF EXISTS "Users can create onboarding status for their business" ON module_onboarding_status;
DROP POLICY IF EXISTS "Users can insert onboarding status for their business" ON module_onboarding_status;
DROP POLICY IF EXISTS "Users can update onboarding status for their business" ON module_onboarding_status;
DROP POLICY IF EXISTS "Owners and managers can update onboarding status" ON module_onboarding_status;
DROP POLICY IF EXISTS "Owners and managers can delete onboarding status" ON module_onboarding_status;

-- Drop any other potential policy variations
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE tablename = 'module_onboarding_status'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON module_onboarding_status', r.policyname);
    END LOOP;
END $$;

-- Step 3: Create SELECT policy using the helper function
-- This avoids RLS recursion issues
CREATE POLICY "Users can view onboarding status for their business"
  ON module_onboarding_status
  FOR SELECT
  USING (check_user_business_access(business_id, auth.uid()));

-- Step 4: Create INSERT policy using the helper function
CREATE POLICY "Users can create onboarding status for their business"
  ON module_onboarding_status
  FOR INSERT
  WITH CHECK (check_user_business_access(business_id, auth.uid()));

-- Step 5: Create UPDATE policy using the helper function
CREATE POLICY "Users can update onboarding status for their business"
  ON module_onboarding_status
  FOR UPDATE
  USING (check_user_business_access(business_id, auth.uid()))
  WITH CHECK (check_user_business_access(business_id, auth.uid()));

-- Step 6: Create DELETE policy (only for elevated roles)
-- Uses helper function to avoid RLS recursion issues
CREATE POLICY "Owners and managers can delete onboarding status"
  ON module_onboarding_status
  FOR DELETE
  USING (check_user_elevated_role(business_id, auth.uid()));

-- Verify the policies were created
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd
FROM pg_policies
WHERE tablename = 'module_onboarding_status'
ORDER BY policyname;
