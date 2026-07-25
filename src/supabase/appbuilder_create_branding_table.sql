-- Step 1: Create app_branding table
-- Table for storing app branding configuration per business

CREATE TABLE IF NOT EXISTS app_branding (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    app_name text,
    primary_color text,
    secondary_color text,
    accent_color text,
    logo_url text,
    favicon_url text,
    store_badges jsonb,
    pwa_settings jsonb,
    legal_imprint text,
    support_email text,
    privacy_url text,
    footer_text text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    
    CONSTRAINT app_branding_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT app_branding_business_id_unique 
        UNIQUE (business_id)
);

-- Create index for business_id lookups
CREATE INDEX IF NOT EXISTS idx_app_branding_business_id 
    ON app_branding(business_id);

-- Enable RLS (policies will be created in Step 31-35)
ALTER TABLE app_branding ENABLE ROW LEVEL SECURITY;

-- Create trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_app_branding_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER app_branding_updated_at
    BEFORE UPDATE ON app_branding
    FOR EACH ROW
    EXECUTE FUNCTION update_app_branding_updated_at();




