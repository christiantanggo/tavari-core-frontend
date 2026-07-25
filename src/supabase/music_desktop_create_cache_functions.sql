-- ============================================================================
-- PHASE 1, STEPS 22-23: Create helper functions for cache management
-- ============================================================================
-- Purpose: Provide utility functions for cache statistics and cleanup
--          Used by monitoring dashboards and automated maintenance jobs
-- ============================================================================

BEGIN;

-- Step 22: Create function to get cache statistics
-- Function: get_installation_cache_stats(installation_id UUID)
-- Returns: JSON with cache size, track count, oldest/newest entries
CREATE OR REPLACE FUNCTION get_installation_cache_stats(p_installation_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_stats JSON;
BEGIN
  SELECT json_build_object(
    'installation_id', p_installation_id,
    'cached_tracks_count', COUNT(*),
    'total_cache_size_bytes', COALESCE(SUM(file_size_bytes), 0),
    'total_cache_size_mb', ROUND(COALESCE(SUM(file_size_bytes), 0)::NUMERIC / 1048576, 2),
    'oldest_cached_entry', MIN(cached_at),
    'newest_cached_entry', MAX(cached_at),
    'total_access_count', COALESCE(SUM(access_count), 0),
    'expired_entries_count', COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at < now())
  )
  INTO v_stats
  FROM music_installation_cache
  WHERE installation_id = p_installation_id;
  
  RETURN v_stats;
END;
$$;

COMMENT ON FUNCTION get_installation_cache_stats(UUID) IS 
  'Returns comprehensive cache statistics for a given installation. Used for monitoring and reporting.';

-- Step 23: Create function to clean expired cache entries
-- Function: cleanup_expired_cache_entries()
-- Deletes entries where expires_at < now()
-- Returns count of deleted entries
CREATE OR REPLACE FUNCTION cleanup_expired_cache_entries()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  DELETE FROM music_installation_cache
  WHERE expires_at IS NOT NULL 
    AND expires_at < now();
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RETURN v_deleted_count;
END;
$$;

COMMENT ON FUNCTION cleanup_expired_cache_entries() IS 
  'Deletes all expired cache entries (where expires_at < now()). Returns count of deleted entries. Can be called by scheduled job.';

COMMIT;




