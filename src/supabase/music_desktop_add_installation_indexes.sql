-- ============================================================================
-- PHASE 1, STEPS 18-19: Add performance indexes
-- ============================================================================
-- Purpose: Optimize query performance for common access patterns
--          Includes indexes for auth lookups, cache management, and health monitoring
-- ============================================================================

BEGIN;

-- Step 18: Add indexes for performance

-- Index on music_installations(installation_key) for fast auth lookups
-- Used when desktop app authenticates using installation key
CREATE INDEX IF NOT EXISTS idx_music_installations_installation_key 
  ON music_installations(installation_key);

COMMENT ON INDEX idx_music_installations_installation_key IS 
  'Optimizes installation key lookups for desktop app authentication. Critical for fast license validation.';

-- Index on music_installation_cache(installation_id, track_id) for fast lookups
-- Used when checking if a track is already cached
CREATE INDEX IF NOT EXISTS idx_installation_cache_installation_track 
  ON music_installation_cache(installation_id, track_id);

COMMENT ON INDEX idx_installation_cache_installation_track IS 
  'Optimizes cache entry lookups by installation and track. Used to check if track is already cached before downloading.';

-- Index on music_installation_cache(last_accessed) for LRU cleanup
-- Used when implementing Least Recently Used cache eviction
CREATE INDEX IF NOT EXISTS idx_installation_cache_last_accessed 
  ON music_installation_cache(last_accessed);

COMMENT ON INDEX idx_installation_cache_last_accessed IS 
  'Optimizes LRU cache eviction queries. Used to find least recently accessed cache entries for cleanup.';

-- Index on music_installation_cache(expires_at) WHERE expires_at IS NOT NULL
-- Used for finding expired cache entries
CREATE INDEX IF NOT EXISTS idx_installation_cache_expires_at 
  ON music_installation_cache(expires_at) 
  WHERE expires_at IS NOT NULL;

COMMENT ON INDEX idx_installation_cache_expires_at IS 
  'Partial index for expired cache entries. Optimizes cleanup of expired cache entries. Only indexes non-null expires_at values.';

-- Index on music_installation_health(installation_id, reported_at DESC) for recent health
-- Used to get the most recent health status for an installation
CREATE INDEX IF NOT EXISTS idx_installation_health_installation_reported 
  ON music_installation_health(installation_id, reported_at DESC);

COMMENT ON INDEX idx_installation_health_installation_reported IS 
  'Optimizes queries for most recent health status per installation. Used for monitoring dashboards and diagnostics.';

COMMIT;




