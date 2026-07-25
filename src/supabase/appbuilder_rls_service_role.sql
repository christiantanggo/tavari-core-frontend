-- Step 47: Add RLS policy for service role access
-- Policies: Allow service role to INSERT builds, update build status, insert analytics
-- Purpose: Allow backend services to update app data

-- Service role can insert builds
DROP POLICY IF EXISTS "app_builds_insert_service_role" ON app_builds;
CREATE POLICY "app_builds_insert_service_role"
ON app_builds FOR INSERT
WITH CHECK (auth.role() = 'service_role');

-- Service role can update build status
DROP POLICY IF EXISTS "app_builds_update_service_role" ON app_builds;
CREATE POLICY "app_builds_update_service_role"
ON app_builds FOR UPDATE
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Service role can insert analytics (already done in Step 45, but keeping for completeness)




