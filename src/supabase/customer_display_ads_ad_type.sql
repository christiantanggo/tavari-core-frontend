-- Add ad_type column to customer_display_ads table
-- This allows separating ads for idle vs transaction states

-- Add the ad_type column
ALTER TABLE customer_display_ads 
ADD COLUMN IF NOT EXISTS ad_type VARCHAR(20) DEFAULT 'idle' CHECK (ad_type IN ('idle', 'transaction'));

-- Add comment for documentation
COMMENT ON COLUMN customer_display_ads.ad_type IS 'Type of ad: idle (full-screen when no transaction) or transaction (half-width during transaction)';

-- Update existing ads to be idle type (default)
UPDATE customer_display_ads 
SET ad_type = 'idle' 
WHERE ad_type IS NULL;
