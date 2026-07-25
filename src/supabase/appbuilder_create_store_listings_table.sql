-- Step 6: Create app_store_listings table
-- Table for App Store and Play Store listing information

CREATE TABLE IF NOT EXISTS app_store_listings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    platform text NOT NULL CHECK (platform IN ('ios', 'android')),
    title text,
    subtitle text,
    description text,
    keywords text[],
    screenshots text[],
    promo_text text,
    support_url text,
    privacy_url text,
    category text,
    age_rating text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    
    CONSTRAINT app_store_listings_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT app_store_listings_business_platform_unique 
        UNIQUE (business_id, platform)
);

-- Create index for business_id lookups
CREATE INDEX IF NOT EXISTS idx_app_store_listings_business_id 
    ON app_store_listings(business_id);

-- Create index for platform queries
CREATE INDEX IF NOT EXISTS idx_app_store_listings_platform 
    ON app_store_listings(platform);

-- Create trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_app_store_listings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER app_store_listings_updated_at
    BEFORE UPDATE ON app_store_listings
    FOR EACH ROW
    EXECUTE FUNCTION update_app_store_listings_updated_at();

-- Enable RLS (policies will be created in Step 42)
ALTER TABLE app_store_listings ENABLE ROW LEVEL SECURITY;




