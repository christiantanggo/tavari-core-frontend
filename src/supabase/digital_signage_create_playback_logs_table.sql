-- Create digital_signage_playback_logs table
-- Purpose: Log all content playback events
-- Dependencies: FK to businesses, screens, content, ads

CREATE TABLE IF NOT EXISTS digital_signage_playback_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    screen_id uuid NOT NULL,
    content_id uuid NOT NULL,
    ad_id uuid,
    zone_id uuid,
    schedule_id uuid,
    playback_started_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    playback_ended_at timestamptz,
    duration_seconds integer,
    completed boolean DEFAULT false,
    skipped boolean DEFAULT false,
    error_message text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT timezone('utc'::text, now()),
    
    CONSTRAINT digital_signage_playback_logs_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT digital_signage_playback_logs_screen_id_fkey 
        FOREIGN KEY (screen_id) 
        REFERENCES digital_signage_screens(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT digital_signage_playback_logs_content_id_fkey 
        FOREIGN KEY (content_id) 
        REFERENCES digital_signage_content(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT digital_signage_playback_logs_ad_id_fkey 
        FOREIGN KEY (ad_id) 
        REFERENCES digital_signage_ads(id) 
        ON DELETE SET NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_digital_signage_playback_logs_business 
    ON digital_signage_playback_logs(business_id);

CREATE INDEX IF NOT EXISTS idx_digital_signage_playback_logs_screen_date 
    ON digital_signage_playback_logs(screen_id, playback_started_at DESC);

CREATE INDEX IF NOT EXISTS idx_digital_signage_playback_logs_content 
    ON digital_signage_playback_logs(content_id);

CREATE INDEX IF NOT EXISTS idx_digital_signage_playback_logs_ad 
    ON digital_signage_playback_logs(ad_id) 
    WHERE ad_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_digital_signage_playback_logs_business_date 
    ON digital_signage_playback_logs(business_id, playback_started_at DESC);

-- Enable RLS
ALTER TABLE digital_signage_playback_logs ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE digital_signage_playback_logs IS 'Log all content playback events for analytics';



