-- Step 9: Create app_analytics table
-- Table for tracking app analytics events

CREATE TABLE IF NOT EXISTS app_analytics (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    event_type text NOT NULL,
    event_data jsonb,
    user_id uuid,
    timestamp timestamptz DEFAULT now(),
    
    CONSTRAINT app_analytics_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT app_analytics_user_id_fkey 
        FOREIGN KEY (user_id) 
        REFERENCES auth.users(id) 
        ON DELETE SET NULL
);

-- Create index for business_id and timestamp queries
CREATE INDEX IF NOT EXISTS idx_app_analytics_business_time 
    ON app_analytics(business_id, timestamp DESC);

-- Create index for event_type queries
CREATE INDEX IF NOT EXISTS idx_app_analytics_business_event_time 
    ON app_analytics(business_id, event_type, timestamp DESC);

-- Enable RLS (policies will be created in Step 45)
ALTER TABLE app_analytics ENABLE ROW LEVEL SECURITY;




