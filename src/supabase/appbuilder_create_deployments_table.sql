-- Step 5: Create app_deployments table
-- Table for tracking app deployments to stores

CREATE TABLE IF NOT EXISTS app_deployments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    build_id uuid NOT NULL,
    deployment_type text NOT NULL CHECK (deployment_type IN ('testflight', 'app_store', 'play_store', 'internal')),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'in_review', 'approved', 'rejected', 'live')),
    submission_date timestamptz,
    approval_date timestamptz,
    rejection_reason text,
    store_listing_id text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    
    CONSTRAINT app_deployments_build_id_fkey 
        FOREIGN KEY (build_id) 
        REFERENCES app_builds(id) 
        ON DELETE CASCADE
);

-- Create index for build_id lookups
CREATE INDEX IF NOT EXISTS idx_app_deployments_build_id 
    ON app_deployments(build_id);

-- Create index for status queries
CREATE INDEX IF NOT EXISTS idx_app_deployments_status 
    ON app_deployments(status, created_at DESC);

-- Create trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_app_deployments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER app_deployments_updated_at
    BEFORE UPDATE ON app_deployments
    FOR EACH ROW
    EXECUTE FUNCTION update_app_deployments_updated_at();

-- Enable RLS (policies will be created in Step 41)
ALTER TABLE app_deployments ENABLE ROW LEVEL SECURITY;




