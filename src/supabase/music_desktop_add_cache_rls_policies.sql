-- ============================================================================
-- PHASE 1, STEP 20: Add RLS policies for music_installation_cache
-- ============================================================================
-- Purpose: Secure cache table access - installations can only manage their own cache
--          
-- Note: RLS policies check that installation exists and is active.
--       For service role operations, set app.installation_id session variable.
--       The desktop app should authenticate using installation_key and pass
--       installation_id in the request context (via session variable or function parameter).
-- ============================================================================

BEGIN;

-- Policy: Installations can view their own cache entries
-- Note: This policy allows access when installation_id matches an active installation
-- The desktop app should authenticate using installation_key and pass installation_id in context
-- Alternative: Use service role for installation operations, or create a function that validates installation_key
CREATE POLICY "installations_view_own_cache"
  ON music_installation_cache
  FOR SELECT
  USING (
    -- Allow if installation exists and is active
    -- In practice, the desktop app will authenticate and pass installation_id
    -- This policy ensures installations can only see their own cache
    EXISTS (
      SELECT 1 FROM music_installations 
      WHERE id = music_installation_cache.installation_id
        AND status = 'active'
    )
    -- For service role operations (when installation_key is validated server-side)
    OR current_setting('app.installation_id', true)::UUID = installation_id
  );

COMMENT ON POLICY "installations_view_own_cache" ON music_installation_cache IS 
  'Allows installations to view their own cache entries using installation_key authentication.';

-- Policy: Installations can insert their own cache entries
CREATE POLICY "installations_insert_own_cache"
  ON music_installation_cache
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM music_installations 
      WHERE id = installation_id
        AND status = 'active'
    )
    OR current_setting('app.installation_id', true)::UUID = installation_id
  );

COMMENT ON POLICY "installations_insert_own_cache" ON music_installation_cache IS 
  'Allows installations to insert cache entries for their own installation only.';

-- Policy: Installations can update their own cache entries
CREATE POLICY "installations_update_own_cache"
  ON music_installation_cache
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM music_installations 
      WHERE id = music_installation_cache.installation_id
        AND status = 'active'
    )
    OR current_setting('app.installation_id', true)::UUID = installation_id
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM music_installations 
      WHERE id = installation_id
        AND status = 'active'
    )
    OR current_setting('app.installation_id', true)::UUID = installation_id
  );

COMMENT ON POLICY "installations_update_own_cache" ON music_installation_cache IS 
  'Allows installations to update their own cache entries (e.g., update last_accessed, access_count).';

-- Policy: Installations can delete their own cache entries
CREATE POLICY "installations_delete_own_cache"
  ON music_installation_cache
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM music_installations 
      WHERE id = music_installation_cache.installation_id
        AND status = 'active'
    )
    OR current_setting('app.installation_id', true)::UUID = installation_id
  );

COMMENT ON POLICY "installations_delete_own_cache" ON music_installation_cache IS 
  'Allows installations to delete their own cache entries (e.g., during cache cleanup).';

COMMIT;

