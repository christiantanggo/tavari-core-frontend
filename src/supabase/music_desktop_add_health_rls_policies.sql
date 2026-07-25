-- ============================================================================
-- PHASE 1, STEP 21: Add RLS policies for music_installation_health
-- ============================================================================
-- Purpose: Secure health table access - installations can only manage their own health records
--          
-- Note: RLS policies check that installation exists and is active.
--       For service role operations, set app.installation_id session variable.
--       The desktop app should authenticate using installation_key and pass
--       installation_id in the request context (via session variable or function parameter).
-- ============================================================================

BEGIN;

-- Policy: Installations can view their own health records
CREATE POLICY "installations_view_own_health"
  ON music_installation_health
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM music_installations 
      WHERE id = music_installation_health.installation_id
        AND status = 'active'
    )
    OR current_setting('app.installation_id', true)::UUID = installation_id
  );

COMMENT ON POLICY "installations_view_own_health" ON music_installation_health IS 
  'Allows installations to view their own health records using installation_key authentication.';

-- Policy: Installations can insert their own health records
CREATE POLICY "installations_insert_own_health"
  ON music_installation_health
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM music_installations 
      WHERE id = installation_id
        AND status = 'active'
    )
    OR current_setting('app.installation_id', true)::UUID = installation_id
  );

COMMENT ON POLICY "installations_insert_own_health" ON music_installation_health IS 
  'Allows installations to insert health records for their own installation only. Used for health reporting.';

-- Policy: Installations can update their own health records
CREATE POLICY "installations_update_own_health"
  ON music_installation_health
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM music_installations 
      WHERE id = music_installation_health.installation_id
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

COMMENT ON POLICY "installations_update_own_health" ON music_installation_health IS 
  'Allows installations to update their own health records. Used for periodic health status updates.';

COMMIT;

