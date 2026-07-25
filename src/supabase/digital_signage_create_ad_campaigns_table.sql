-- Create digital_signage_ad_campaigns table
-- Purpose: Manage ad campaigns (local, network, sponsored)
-- Dependencies: None (only FK to businesses and users)

CREATE TABLE IF NOT EXISTS digital_signage_ad_campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    campaign_name text NOT NULL,
    advertiser_id uuid,
    campaign_type text NOT NULL CHECK (campaign_type IN ('local', 'network', 'sponsored')),
    budget_total numeric(10, 2),
    budget_spent numeric(10, 2) DEFAULT 0,
    start_date date NOT NULL,
    end_date date NOT NULL,
    target_impressions integer,
    target_clicks integer,
    status text DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'cancelled')),
    created_by uuid,
    created_at timestamptz DEFAULT timezone('utc'::text, now()),
    updated_at timestamptz DEFAULT timezone('utc'::text, now()),
    
    CONSTRAINT digital_signage_ad_campaigns_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT digital_signage_ad_campaigns_advertiser_id_fkey 
        FOREIGN KEY (advertiser_id) 
        REFERENCES businesses(id) 
        ON DELETE SET NULL,
    
    CONSTRAINT digital_signage_ad_campaigns_created_by_fkey 
        FOREIGN KEY (created_by) 
        REFERENCES users(id) 
        ON DELETE SET NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_digital_signage_ad_campaigns_business 
    ON digital_signage_ad_campaigns(business_id);

CREATE INDEX IF NOT EXISTS idx_digital_signage_ad_campaigns_business_status 
    ON digital_signage_ad_campaigns(business_id, status, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_digital_signage_ad_campaigns_advertiser 
    ON digital_signage_ad_campaigns(advertiser_id) 
    WHERE advertiser_id IS NOT NULL;

-- Enable RLS
ALTER TABLE digital_signage_ad_campaigns ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE digital_signage_ad_campaigns IS 'Ad campaigns for digital signage (local, network, sponsored)';



