-- ============================================================================
-- PHASE 1, STEPS 9-14: Create music_installation_cache table
-- ============================================================================
-- Purpose: Track individual cached track files for each installation
--          Enables LRU cache management and integrity verification
-- ============================================================================

BEGIN;

-- Step 10: Create music_installation_cache table structure
CREATE TABLE IF NOT EXISTS music_installation_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  installation_id UUID NOT NULL,
  track_id UUID NOT NULL,
  file_path TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  cached_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  last_accessed TIMESTAMP WITH TIME ZONE DEFAULT now(),
  access_count INTEGER DEFAULT 0,
  checksum TEXT, -- MD5/SHA256 for integrity verification
  expires_at TIMESTAMP WITH TIME ZONE, -- Nullable, for cache expiration
  
  -- Step 11: Foreign key constraints
  CONSTRAINT fk_installation_cache_installation 
    FOREIGN KEY (installation_id) 
    REFERENCES music_installations(id) 
    ON DELETE CASCADE,
  CONSTRAINT fk_installation_cache_track 
    FOREIGN KEY (track_id) 
    REFERENCES music_tracks(id) 
    ON DELETE CASCADE,
  
  -- Step 12: Unique constraint - prevents duplicate cache entries
  CONSTRAINT uq_installation_cache_installation_track 
    UNIQUE (installation_id, track_id),
  
  -- Step 13: Check constraints
  CONSTRAINT chk_installation_cache_file_size 
    CHECK (file_size_bytes > 0),
  CONSTRAINT chk_installation_cache_access_count 
    CHECK (access_count >= 0),
  CONSTRAINT chk_installation_cache_expires_after_cached 
    CHECK (expires_at IS NULL OR expires_at > cached_at)
);

-- Step 14: Add comments to document columns
COMMENT ON TABLE music_installation_cache IS 
  'Tracks individual cached track files for desktop player installations. Enables LRU cache management and integrity verification.';

COMMENT ON COLUMN music_installation_cache.id IS 
  'Primary key, UUID';

COMMENT ON COLUMN music_installation_cache.installation_id IS 
  'Foreign key to music_installations table. Identifies which installation owns this cache entry.';

COMMENT ON COLUMN music_installation_cache.track_id IS 
  'Foreign key to music_tracks table. Identifies which track is cached.';

COMMENT ON COLUMN music_installation_cache.file_path IS 
  'Local file system path where the cached track file is stored on the installation device.';

COMMENT ON COLUMN music_installation_cache.file_size_bytes IS 
  'Size of the cached file in bytes. Used for cache size management.';

COMMENT ON COLUMN music_installation_cache.cached_at IS 
  'Timestamp when the track was first cached. Used for cache age tracking.';

COMMENT ON COLUMN music_installation_cache.last_accessed IS 
  'Timestamp when the cache entry was last accessed. Used for LRU cache eviction.';

COMMENT ON COLUMN music_installation_cache.access_count IS 
  'Number of times this cache entry has been accessed. Used for cache analytics.';

COMMENT ON COLUMN music_installation_cache.checksum IS 
  'MD5 or SHA256 hash of the cached file. Used for integrity verification to detect corruption.';

COMMENT ON COLUMN music_installation_cache.expires_at IS 
  'Optional expiration timestamp. If set, cache entry will be considered expired after this time.';

-- Enable RLS (policies will be added in Step 20)
ALTER TABLE music_installation_cache ENABLE ROW LEVEL SECURITY;

COMMIT;




