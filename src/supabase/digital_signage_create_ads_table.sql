-- Create digital_signage_ads table
-- Purpose: Advertisements for digital signage
-- Dependencies: FK to businesses, users, content, campaigns

CREATE TABLE IF NOT EXISTS digital_signage_ads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    ad_name text NOT NULL,
    ad_type text NOT NULL CHECK (ad_type IN ('local', 'network', 'sponsored')),
    content_id uuid NOT NULL,
    advertiser_name text,
    advertiser_id uuid,
    campaign_id uuid,
    target_screens uuid[],
    target_groups uuid[],
    target_zones uuid[],
    start_date date,
    end_date date,
    start_time time without time zone,
    end_time time without time zone,
    days_of_week integer[],
    max_impressions integer,
    max_clicks integer,
    current_impressions integer DEFAULT 0,
    current_clicks integer DEFAULT 0,
    cpm_rate numeric(10, 4),
    cpc_rate numeric(10, 4),
    revenue_share_percent numeric(5, 2),
    click_url text,
    status text DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'active', 'paused', 'completed', 'rejected')),
    is_active boolean DEFAULT true,
    created_by uuid,
    created_at timestamptz DEFAULT timezone('utc'::text, now()),
    updated_at timestamptz DEFAULT timezone('utc'::text, now()),
    
    CONSTRAINT digital_signage_ads_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT digital_signage_ads_content_id_fkey 
        FOREIGN KEY (content_id) 
        REFERENCES digital_signage_content(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT digital_signage_ads_campaign_id_fkey 
        FOREIGN KEY (campaign_id) 
        REFERENCES digital_signage_ad_campaigns(id) 
        ON DELETE SET NULL,
    
    CONSTRAINT digital_signage_ads_advertiser_id_fkey 
        FOREIGN KEY (advertiser_id) 
        REFERENCES businesses(id) 
        ON DELETE SET NULL,
    
    CONSTRAINT digital_signage_ads_created_by_fkey 
        FOREIGN KEY (created_by) 
        REFERENCES users(id) 
        ON DELETE SET NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_digital_signage_ads_business 
    ON digital_signage_ads(business_id);

CREATE INDEX IF NOT EXISTS idx_digital_signage_ads_business_active 
    ON digital_signage_ads(business_id, is_active, start_date, end_date) 
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_digital_signage_ads_campaign 
    ON digital_signage_ads(campaign_id) 
    WHERE campaign_id IS NOT NULL;

-- Enable RLS
ALTER TABLE digital_signage_ads ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE digital_signage_ads IS 'Advertisements for digital signage';



