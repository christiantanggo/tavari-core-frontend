-- Step 7: Create app_preview_configs table
-- Table for app preview configurations with share tokens

CREATE TABLE IF NOT EXISTS app_preview_configs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    preview_url text,
    qr_code_url text,
    share_token text UNIQUE,
    expires_at timestamptz,
    created_at timestamptz DEFAULT now(),
    
    CONSTRAINT app_preview_configs_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE
);

-- Create index for share_token (for public preview access)
CREATE INDEX IF NOT EXISTS idx_app_preview_configs_token 
    ON app_preview_configs(share_token);

-- Create index for business_id lookups
CREATE INDEX IF NOT EXISTS idx_app_preview_configs_business_id 
    ON app_preview_configs(business_id);

-- Enable RLS (policies will be created in Step 43)
ALTER TABLE app_preview_configs ENABLE ROW LEVEL SECURITY;



