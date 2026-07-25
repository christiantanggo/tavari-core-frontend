-- Step 4: Create app_builds table
-- Table for tracking app builds (iOS/Android)

CREATE TABLE IF NOT EXISTS app_builds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    app_version text NOT NULL,
    platform text NOT NULL CHECK (platform IN ('ios', 'android', 'both')),
    build_number integer NOT NULL,
    build_status text NOT NULL DEFAULT 'queued' CHECK (build_status IN ('queued', 'building', 'success', 'failed', 'cancelled')),
    build_log_url text,
    artifact_url text,
    error_message text,
    created_by uuid,
    created_at timestamptz DEFAULT now(),
    completed_at timestamptz,
    
    CONSTRAINT app_builds_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT app_builds_created_by_fkey 
        FOREIGN KEY (created_by) 
        REFERENCES auth.users(id) 
        ON DELETE SET NULL
);

-- Create index for business status queries
CREATE INDEX IF NOT EXISTS idx_app_builds_business_status 
    ON app_builds(business_id, build_status, created_at DESC);

-- Create index for platform queries
CREATE INDEX IF NOT EXISTS idx_app_builds_business_platform 
    ON app_builds(business_id, platform, created_at DESC);

-- Enable RLS (policies will be created in Step 40)
ALTER TABLE app_builds ENABLE ROW LEVEL SECURITY;

-- Create trigger to update completed_at when build_status changes
CREATE OR REPLACE FUNCTION update_app_builds_completed_at()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.build_status IN ('success', 'failed', 'cancelled') AND OLD.build_status NOT IN ('success', 'failed', 'cancelled') THEN
        NEW.completed_at = now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER app_builds_status_change
    AFTER UPDATE ON app_builds
    FOR EACH ROW
    WHEN (NEW.build_status IN ('success', 'failed', 'cancelled'))
    EXECUTE FUNCTION update_app_builds_completed_at();




