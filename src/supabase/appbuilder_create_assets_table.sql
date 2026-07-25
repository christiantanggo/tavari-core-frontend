-- Step 8: Create app_assets table
-- Table for storing app assets (logos, icons, screenshots, etc.)

CREATE TABLE IF NOT EXISTS app_assets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    asset_type text NOT NULL CHECK (asset_type IN ('logo', 'icon', 'splash', 'screenshot', 'favicon', 'other')),
    asset_url text NOT NULL,
    storage_path text,
    file_size bigint,
    mime_type text,
    dimensions jsonb,
    created_at timestamptz DEFAULT now(),
    
    CONSTRAINT app_assets_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE
);

-- Create index for business_id and asset_type lookups
CREATE INDEX IF NOT EXISTS idx_app_assets_business_type 
    ON app_assets(business_id, asset_type);

-- Create index for asset_type filtering
CREATE INDEX IF NOT EXISTS idx_app_assets_asset_type 
    ON app_assets(asset_type);

-- Enable RLS (policies will be created in Step 44)
ALTER TABLE app_assets ENABLE ROW LEVEL SECURITY;




