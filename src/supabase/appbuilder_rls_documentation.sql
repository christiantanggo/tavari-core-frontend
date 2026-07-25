-- Step 50: Document RLS policy patterns
-- This file documents all RLS policies and their purposes

/*
RLS Policy Patterns for AppBuilder Module:

1. SELECT Policies:
   - Business members: Use user_roles table WHERE user_id = auth.uid() AND active = true
   - Employees: Use tavari_employees table WHERE user_id = auth.uid() AND is_active = true
   - Public: Use auth.role() = 'authenticated' or share_token for public access

2. INSERT Policies:
   - Owners/managers: Use user_roles WHERE role IN ('owner', 'admin', 'manager') AND active = true
   - Service role: Use auth.role() = 'service_role' for backend operations

3. UPDATE Policies:
   - Owners/managers: Same as INSERT
   - Service role: Use auth.role() = 'service_role' for backend operations

4. DELETE Policies:
   - Owners only: Use user_roles WHERE role = 'owner' AND active = true

5. Tables and their RLS patterns:
   - app_branding: Business members SELECT, owners/managers INSERT/UPDATE, owners DELETE
   - business_module_usage: Employees/managers SELECT (via tavari_employees + user_roles), managers INSERT/UPDATE
   - app_builds: Business members SELECT, owners/managers INSERT/UPDATE, service role INSERT/UPDATE
   - app_deployments: Business members SELECT (via build_id), owners/managers INSERT/UPDATE
   - app_store_listings: Business members SELECT, owners/managers INSERT/UPDATE
   - app_preview_configs: Public SELECT (via share_token), business members SELECT/INSERT/UPDATE/DELETE
   - app_assets: Business members SELECT, owners/managers INSERT/UPDATE/DELETE
   - app_analytics: Business members SELECT, authenticated users + service role INSERT
   - app_webhooks: Owners only (all operations)
   - app_modules: Authenticated users SELECT (global catalog)

6. Reference Tables Used:
   - user_roles: id, user_id, business_id, role, active, custom_permissions, created_at
   - tavari_employees: user_id, is_active (for employee access)
   - businesses: id (for business_id foreign keys)

7. Service Role Access:
   - app_builds: INSERT, UPDATE (for build system)
   - app_analytics: INSERT (for analytics tracking)
   - All other tables: No service role access (restricted to authenticated users with proper roles)

8. Pattern Reuse:
   - All policies follow existing Tavari module patterns
   - Uses same user_roles table structure as POS/Music/HR modules
   - Follows same business_id isolation pattern
*/

SELECT 'RLS policy documentation completed' AS status;




