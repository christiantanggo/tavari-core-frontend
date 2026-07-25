-- Create digital_signage_settings table
-- Purpose: Global settings for digital signage module
-- Dependencies: FK to businesses

CREATE TABLE IF NOT EXISTS digital_signage_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL UNIQUE,
    default_timezone text DEFAULT 'America/Toronto',
    default_transition_type text DEFAULT 'fade',
    default_transition_duration_ms integer DEFAULT 500,
    auto_play_enabled boolean DEFAULT true,
    content_cache_enabled boolean DEFAULT true,
    content_cache_duration_minutes integer DEFAULT 60,
    heartbeat_interval_seconds integer DEFAULT 30,
    offline_mode_enabled boolean DEFAULT false,
    ad_network_enabled boolean DEFAULT false,
    ad_network_providers jsonb DEFAULT '[]'::jsonb,
    analytics_enabled boolean DEFAULT true,
    analytics_retention_days integer DEFAULT 90,
    notification_settings jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT timezone('utc'::text, now()),
    updated_at timestamptz DEFAULT timezone('utc'::text, now()),
    
    CONSTRAINT digital_signage_settings_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_digital_signage_settings_business 
    ON digital_signage_settings(business_id);

-- Enable RLS
ALTER TABLE digital_signage_settings ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE digital_signage_settings IS 'Global settings for digital signage module';



