-- ============================================================================
-- PHASE 1, STEPS 1-7: Add cache-related columns to music_installations table
-- ============================================================================
-- Purpose: Extend music_installations table to track offline cache statistics
--          and configuration for desktop player installations
-- ============================================================================

BEGIN;

-- Step 2: Add cached_tracks_count column
-- Number of tracks currently cached locally on the installation
ALTER TABLE music_installations
ADD COLUMN IF NOT EXISTS cached_tracks_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN music_installations.cached_tracks_count IS 
  'Number of tracks currently cached locally on this installation';

-- Step 3: Add cache_size_bytes column
-- Total size of cached files in bytes
ALTER TABLE music_installations
ADD COLUMN IF NOT EXISTS cache_size_bytes BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN music_installations.cache_size_bytes IS 
  'Total size of cached files in bytes';

-- Step 4: Add last_cache_sync column
-- Last time cache was synchronized with server
ALTER TABLE music_installations
ADD COLUMN IF NOT EXISTS last_cache_sync TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN music_installations.last_cache_sync IS 
  'Last time cache was synchronized with server';

-- Step 5: Add cache_version column
-- Version of cache format/structure
ALTER TABLE music_installations
ADD COLUMN IF NOT EXISTS cache_version TEXT NOT NULL DEFAULT '1.0';

COMMENT ON COLUMN music_installations.cache_version IS 
  'Version of cache format/structure';

-- Step 6: Add offline_mode_enabled column
-- Whether offline caching is enabled
ALTER TABLE music_installations
ADD COLUMN IF NOT EXISTS offline_mode_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN music_installations.offline_mode_enabled IS 
  'Whether offline caching is enabled for this installation';

-- Step 7: Add max_cache_size_mb column
-- Maximum cache size in megabytes
ALTER TABLE music_installations
ADD COLUMN IF NOT EXISTS max_cache_size_mb INTEGER NOT NULL DEFAULT 500;

COMMENT ON COLUMN music_installations.max_cache_size_mb IS 
  'Maximum cache size in megabytes for this installation';

COMMIT;




