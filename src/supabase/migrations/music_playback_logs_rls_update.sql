-- Migration: Update RLS policies for music_v2_playback_logs
-- Purpose: Allow business-based access in addition to location/device-based
-- Date: 2024

-- Drop existing policies if they exist (we'll recreate them)
DROP POLICY IF EXISTS "music_v2_playback_logs_select" ON music_v2_playback_logs;
DROP POLICY IF EXISTS "music_v2_playback_logs_business_select" ON music_v2_playback_logs;
DROP POLICY IF EXISTS "music_v2_playback_logs_insert" ON music_v2_playback_logs;
DROP POLICY IF EXISTS "music_v2_playback_logs_business_insert" ON music_v2_playback_logs;

-- SELECT Policy: Allow users to read logs for their businesses
-- Supports both location-based (v2) and business-based (v1) access
CREATE POLICY "music_v2_playback_logs_select" ON music_v2_playback_logs
  FOR SELECT
  USING (
    -- Business-based access (for web/desktop apps)
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.business_id = music_v2_playback_logs.business_id
      AND ur.active = true
    )
    OR
    -- Location-based access (for v2 system)
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN music_v2_locations loc ON loc.business_id = ur.business_id
      WHERE ur.user_id = auth.uid()
      AND loc.id = music_v2_playback_logs.location_id
      AND ur.active = true
    )
    OR
    -- Installation-based access (for Electron desktop apps)
    EXISTS (
      SELECT 1 FROM music_installations mi
      JOIN user_roles ur ON ur.business_id = mi.business_id
      WHERE mi.id = music_v2_playback_logs.installation_id
      AND ur.user_id = auth.uid()
      AND ur.active = true
    )
  );

-- INSERT Policy: Allow authenticated users to insert logs for their businesses
CREATE POLICY "music_v2_playback_logs_insert" ON music_v2_playback_logs
  FOR INSERT
  WITH CHECK (
    -- Business-based insert (for web/desktop apps)
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.business_id = music_v2_playback_logs.business_id
      AND ur.active = true
    )
    OR
    -- Device-based insert (for v2 devices with token)
    EXISTS (
      SELECT 1 FROM music_v2_devices d
      WHERE d.id = music_v2_playback_logs.device_id
      AND d.device_token = current_setting('app.device_token', true)
    )
    OR
    -- Installation-based insert (for Electron desktop apps)
    EXISTS (
      SELECT 1 FROM music_installations mi
      JOIN user_roles ur ON ur.business_id = mi.business_id
      WHERE mi.id = music_v2_playback_logs.installation_id
      AND ur.user_id = auth.uid()
      AND ur.active = true
    )
  );

-- UPDATE Policy: Allow users to update logs for their businesses
CREATE POLICY "music_v2_playback_logs_update" ON music_v2_playback_logs
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.business_id = music_v2_playback_logs.business_id
      AND ur.active = true
    )
    OR
    EXISTS (
      SELECT 1 FROM music_installations mi
      JOIN user_roles ur ON ur.business_id = mi.business_id
      WHERE mi.id = music_v2_playback_logs.installation_id
      AND ur.user_id = auth.uid()
      AND ur.active = true
    )
  );

-- Add comments
COMMENT ON POLICY "music_v2_playback_logs_select" ON music_v2_playback_logs IS 
  'Allows users to read playback logs for businesses they have access to';

COMMENT ON POLICY "music_v2_playback_logs_insert" ON music_v2_playback_logs IS 
  'Allows authenticated users and devices to insert playback logs';

COMMENT ON POLICY "music_v2_playback_logs_update" ON music_v2_playback_logs IS 
  'Allows users to update playback logs for their businesses';




