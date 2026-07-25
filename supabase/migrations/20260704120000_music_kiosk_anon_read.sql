-- Music kiosk: read playback data without staff login (business ID only, like waiver kiosk).
-- Client filters by business_id; UUID is the access boundary (same model as public waiver URLs).

DROP POLICY IF EXISTS "Music kiosk anon read tracks" ON music_tracks;
CREATE POLICY "Music kiosk anon read tracks"
  ON music_tracks FOR SELECT TO anon
  USING (business_id IS NOT NULL);

DROP POLICY IF EXISTS "Music kiosk anon read playlists" ON music_playlists;
CREATE POLICY "Music kiosk anon read playlists"
  ON music_playlists FOR SELECT TO anon
  USING (business_id IS NOT NULL);

DROP POLICY IF EXISTS "Music kiosk anon read playlist tracks" ON music_playlist_tracks;
CREATE POLICY "Music kiosk anon read playlist tracks"
  ON music_playlist_tracks FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM music_playlists p
      WHERE p.id = music_playlist_tracks.playlist_id
    )
  );

DROP POLICY IF EXISTS "Music kiosk anon read schedules" ON music_playlist_schedules;
CREATE POLICY "Music kiosk anon read schedules"
  ON music_playlist_schedules FOR SELECT TO anon
  USING (business_id IS NOT NULL AND active IS TRUE);

DROP POLICY IF EXISTS "Music kiosk anon read settings" ON music_settings;
CREATE POLICY "Music kiosk anon read settings"
  ON music_settings FOR SELECT TO anon
  USING (business_id IS NOT NULL);

DROP POLICY IF EXISTS "Music kiosk anon read local ads" ON music_local_ads;
CREATE POLICY "Music kiosk anon read local ads"
  ON music_local_ads FOR SELECT TO anon
  USING (business_id IS NOT NULL);
