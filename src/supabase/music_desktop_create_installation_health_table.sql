-- ============================================================================
-- PHASE 1, STEPS 15-17: Create music_installation_health table
-- ============================================================================
-- Purpose: Track health status and error metrics for desktop player installations
--          Enables monitoring, diagnostics, and proactive issue detection
-- ============================================================================

BEGIN;

-- Step 16: Create music_installation_health table structure
CREATE TABLE IF NOT EXISTS music_installation_health (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  installation_id UUID NOT NULL,
  health_status TEXT NOT NULL CHECK (health_status IN ('healthy', 'degraded', 'offline', 'error')),
  last_online_check TIMESTAMP WITH TIME ZONE,
  last_playback_check TIMESTAMP WITH TIME ZONE,
  playback_errors_count INTEGER DEFAULT 0,
  network_errors_count INTEGER DEFAULT 0,
  cache_errors_count INTEGER DEFAULT 0,
  last_error_message TEXT,
  reported_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  
  -- Step 17: Foreign key constraint
  CONSTRAINT fk_installation_health_installation 
    FOREIGN KEY (installation_id) 
    REFERENCES music_installations(id) 
    ON DELETE CASCADE
);

-- Add comments to document columns
COMMENT ON TABLE music_installation_health IS 
  'Tracks health status and error metrics for desktop player installations. Enables monitoring and diagnostics.';

COMMENT ON COLUMN music_installation_health.id IS 
  'Primary key, UUID';

COMMENT ON COLUMN music_installation_health.installation_id IS 
  'Foreign key to music_installations table. Identifies which installation this health record belongs to.';

COMMENT ON COLUMN music_installation_health.health_status IS 
  'Current health status: healthy (normal operation), degraded (minor issues), offline (no connection), error (critical issues).';

COMMENT ON COLUMN music_installation_health.last_online_check IS 
  'Timestamp of last successful online connectivity check. Used to detect network issues.';

COMMENT ON COLUMN music_installation_health.last_playback_check IS 
  'Timestamp of last successful playback verification. Used to detect playback issues.';

COMMENT ON COLUMN music_installation_health.playback_errors_count IS 
  'Count of playback-related errors since last reset. Used for error rate tracking.';

COMMENT ON COLUMN music_installation_health.network_errors_count IS 
  'Count of network-related errors since last reset. Used for connectivity issue tracking.';

COMMENT ON COLUMN music_installation_health.cache_errors_count IS 
  'Count of cache-related errors since last reset. Used for storage issue tracking.';

COMMENT ON COLUMN music_installation_health.last_error_message IS 
  'Most recent error message. Provides context for troubleshooting.';

COMMENT ON COLUMN music_installation_health.reported_at IS 
  'Timestamp when this health record was created or last updated. Used for chronological tracking.';

-- Enable RLS (policies will be added in Step 21)
ALTER TABLE music_installation_health ENABLE ROW LEVEL SECURITY;

COMMIT;




