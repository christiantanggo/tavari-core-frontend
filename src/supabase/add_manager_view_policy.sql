-- Add policy to allow owners/managers to view all business_users in their businesses
-- This works alongside the existing "Users can view their own business associations" policy

-- Create the new policy that allows managers to see all business_users
CREATE POLICY "Managers can view all business_users in their businesses"
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

-- Verify the policy was created
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
