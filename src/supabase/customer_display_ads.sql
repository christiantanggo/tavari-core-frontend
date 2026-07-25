-- Customer Display Ads Table
-- This table stores advertisements and promotional content for the customer-facing display

CREATE TABLE IF NOT EXISTS customer_display_ads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    image_url TEXT NOT NULL,
    promo_code VARCHAR(50),
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    created_by UUID REFERENCES users(id)
);

-- Add RLS (Row Level Security)
ALTER TABLE customer_display_ads ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see ads for their business
CREATE POLICY "Users can view ads for their business" ON customer_display_ads
    FOR SELECT USING (
        business_id IN (
            SELECT business_id FROM business_users 
            WHERE user_id = auth.uid()
        )
    );

-- Policy: Users can insert ads for their business
CREATE POLICY "Users can insert ads for their business" ON customer_display_ads
    FOR INSERT WITH CHECK (
        business_id IN (
            SELECT business_id FROM business_users 
            WHERE user_id = auth.uid()
        )
    );

-- Policy: Users can update ads for their business
CREATE POLICY "Users can update ads for their business" ON customer_display_ads
    FOR UPDATE USING (
        business_id IN (
            SELECT business_id FROM business_users 
            WHERE user_id = auth.uid()
        )
    );

-- Policy: Users can delete ads for their business
CREATE POLICY "Users can delete ads for their business" ON customer_display_ads
    FOR DELETE USING (
        business_id IN (
            SELECT business_id FROM business_users 
            WHERE user_id = auth.uid()
        )
    );

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_customer_display_ads_business_id ON customer_display_ads(business_id);
CREATE INDEX IF NOT EXISTS idx_customer_display_ads_active ON customer_display_ads(is_active);
CREATE INDEX IF NOT EXISTS idx_customer_display_ads_order ON customer_display_ads(display_order);

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_customer_display_ads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_customer_display_ads_updated_at
    BEFORE UPDATE ON customer_display_ads
    FOR EACH ROW
    EXECUTE FUNCTION update_customer_display_ads_updated_at();
