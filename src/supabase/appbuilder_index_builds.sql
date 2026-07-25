-- Step 24: Create index on app_builds for status queries
-- Index for business/platform/status queries

CREATE INDEX IF NOT EXISTS idx_app_builds_business_platform_status 
    ON app_builds(business_id, platform, build_status, created_at DESC);

-- Additional index for build status monitoring
CREATE INDEX IF NOT EXISTS idx_app_builds_status_created 
    ON app_builds(build_status, created_at DESC) 
    WHERE build_status IN ('queued', 'building');




