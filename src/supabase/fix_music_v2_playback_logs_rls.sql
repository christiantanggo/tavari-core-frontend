-- Fix RLS policies for music_v2_playback_logs
-- Issue: When user is logged out (401 Unauthorized), auth.uid() is NULL, causing policy failures
-- 
-- Analysis from database:
-- - RLS is enabled ✓
-- - Two INSERT policies exist (one is redundant)
-- - 34,105 logs exist, most with business_id
-- - Error occurs when user is logged out
--
-- Solution: Remove duplicate policy and ensure service checks auth before inserting
-- (Service has been updated to check authentication first)

-- Drop the duplicate device_insert policy
-- The main music_v2_playback_logs_insert policy already covers device inserts
DROP POLICY IF EXISTS "music_v2_playback_logs_device_insert" ON music_v2_playback_logs;

-- The existing music_v2_playback_logs_insert policy is correct and covers:
-- 1. Authenticated users with business_id matching their user_roles
-- 2. Devices with valid token (via device_id check)
-- 3. Installations belonging to authenticated user's business
--
-- No changes needed to the policy itself.
-- The service (PlaybackTrackingService.js) now checks authentication before attempting inserts.

COMMENT ON POLICY "music_v2_playback_logs_insert" ON music_v2_playback_logs IS 
  'Allows inserts when: user has business role, device has token, or installation belongs to user business';
