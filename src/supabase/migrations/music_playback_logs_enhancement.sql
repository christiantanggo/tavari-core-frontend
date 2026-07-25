-- Migration: Enhance music_v2_playback_logs table for song tracking
-- Purpose: Add business_id and installation_id columns for easier querying
-- Date: 2024

-- Add business_id column if it doesn't exist (for direct business queries)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'music_v2_playback_logs' 
    AND column_name = 'business_id'
  ) THEN
    ALTER TABLE music_v2_playback_logs 
    ADD COLUMN business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
    
    COMMENT ON COLUMN music_v2_playback_logs.business_id IS 
      'Business ID for direct queries without joining through device/location tables';
  END IF;
END $$;

-- Add installation_id column if it doesn't exist (for Electron desktop app tracking)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'music_v2_playback_logs' 
    AND column_name = 'installation_id'
  ) THEN
    ALTER TABLE music_v2_playback_logs 
    ADD COLUMN installation_id UUID REFERENCES music_installations(id) ON DELETE SET NULL;
    
    COMMENT ON COLUMN music_v2_playback_logs.installation_id IS 
      'Installation ID for Electron desktop app installations';
  END IF;
END $$;

-- Add error column for tracking playback errors
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'music_v2_playback_logs' 
    AND column_name = 'error'
  ) THEN
    ALTER TABLE music_v2_playback_logs 
    ADD COLUMN error TEXT;
    
    COMMENT ON COLUMN music_v2_playback_logs.error IS 
      'Error message if playback failed';
  END IF;
END $$;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_playback_logs_business_time 
  ON music_v2_playback_logs(business_id, start_time DESC)
  WHERE business_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_playback_logs_installation_time 
  ON music_v2_playback_logs(installation_id, start_time DESC)
  WHERE installation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_playback_logs_track_time 
  ON music_v2_playback_logs(track_id, start_time DESC)
  WHERE track_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_playback_logs_playlist_time 
  ON music_v2_playback_logs(playlist_id, start_time DESC)
  WHERE playlist_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_playback_logs_type_time 
  ON music_v2_playback_logs(log_type, start_time DESC);

CREATE INDEX IF NOT EXISTS idx_playback_logs_completed 
  ON music_v2_playback_logs(completed, start_time DESC);

-- Add comments
COMMENT ON TABLE music_v2_playback_logs IS 
  'Tracks all song and ad playback events. Supports both web and Electron desktop app tracking.';

COMMENT ON INDEX idx_playback_logs_business_time IS 
  'Fast queries for business playback history';

COMMENT ON INDEX idx_playback_logs_installation_time IS 
  'Fast queries for installation-specific playback history';

COMMENT ON INDEX idx_playback_logs_track_time IS 
  'Fast queries for track play history';

COMMENT ON INDEX idx_playback_logs_playlist_time IS 
  'Fast queries for playlist play history';




