-- ============================================================================
-- PHASE 1, STEP 24: Create trigger to update music_installations cache stats
-- ============================================================================
-- Purpose: Automatically maintain cache statistics in music_installations table
--          Keeps cached_tracks_count and cache_size_bytes in sync
-- ============================================================================

BEGIN;

-- Function to update cache statistics in music_installations table
CREATE OR REPLACE FUNCTION update_installation_cache_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Update cache statistics for the affected installation
  UPDATE music_installations
  SET 
    cached_tracks_count = (
      SELECT COUNT(*) 
      FROM music_installation_cache 
      WHERE installation_id = COALESCE(NEW.installation_id, OLD.installation_id)
    ),
    cache_size_bytes = (
      SELECT COALESCE(SUM(file_size_bytes), 0)
      FROM music_installation_cache 
      WHERE installation_id = COALESCE(NEW.installation_id, OLD.installation_id)
    ),
    last_cache_sync = now()
  WHERE id = COALESCE(NEW.installation_id, OLD.installation_id);
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION update_installation_cache_stats() IS 
  'Trigger function that automatically updates cache statistics in music_installations table when cache entries change.';

-- Trigger: After INSERT/UPDATE/DELETE on music_installation_cache
CREATE TRIGGER trg_update_installation_cache_stats
  AFTER INSERT OR UPDATE OR DELETE ON music_installation_cache
  FOR EACH ROW
  EXECUTE FUNCTION update_installation_cache_stats();

COMMENT ON TRIGGER trg_update_installation_cache_stats ON music_installation_cache IS 
  'Automatically updates cached_tracks_count and cache_size_bytes in music_installations table when cache entries are added, updated, or deleted.';

COMMIT;




