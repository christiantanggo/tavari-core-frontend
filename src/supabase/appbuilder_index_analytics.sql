-- Step 25: Create index on app_analytics for reporting
-- Index for business/event/time queries

CREATE INDEX IF NOT EXISTS idx_app_analytics_business_event_time 
    ON app_analytics(business_id, event_type, timestamp DESC);

-- Additional index for time-based queries
CREATE INDEX IF NOT EXISTS idx_app_analytics_timestamp 
    ON app_analytics(timestamp DESC);




