-- ============================================================================
-- Music V2 Module - RLS Policies
-- ============================================================================
-- Row Level Security policies for all music_v2_ tables
-- ============================================================================

-- ============================================================================
-- PLANS & PRICING (Public read, Admin write)
-- ============================================================================

-- Plans: Everyone can read active plans, only admins can modify
CREATE POLICY "music_v2_plans_select_active" ON music_v2_plans
  FOR SELECT
  USING (is_active = true);

CREATE POLICY "music_v2_plans_admin_insert" ON music_v2_plans
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin')
      AND ur.active = true
    )
  );

CREATE POLICY "music_v2_plans_admin_update" ON music_v2_plans
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin')
      AND ur.active = true
    )
  );

CREATE POLICY "music_v2_plans_admin_delete" ON music_v2_plans
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin')
      AND ur.active = true
    )
  );

-- Pricing Matrix: Everyone can read, only admins can modify
CREATE POLICY "music_v2_pricing_matrix_select" ON music_v2_pricing_matrix
  FOR SELECT
  USING (true);

CREATE POLICY "music_v2_pricing_matrix_admin_insert" ON music_v2_pricing_matrix
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin')
      AND ur.active = true
    )
  );

CREATE POLICY "music_v2_pricing_matrix_admin_update" ON music_v2_pricing_matrix
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin')
      AND ur.active = true
    )
  );

CREATE POLICY "music_v2_pricing_matrix_admin_delete" ON music_v2_pricing_matrix
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin')
      AND ur.active = true
    )
  );

-- ============================================================================
-- LOCATIONS (Business-scoped)
-- ============================================================================

-- Locations: Users can access their business locations
CREATE POLICY "music_v2_locations_select" ON music_v2_locations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.business_id = music_v2_locations.business_id
      AND ur.active = true
    )
  );

CREATE POLICY "music_v2_locations_insert" ON music_v2_locations
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.business_id = music_v2_locations.business_id
      AND ur.role IN ('owner', 'admin', 'manager')
      AND ur.active = true
    )
  );

CREATE POLICY "music_v2_locations_update" ON music_v2_locations
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.business_id = music_v2_locations.business_id
      AND ur.role IN ('owner', 'admin', 'manager')
      AND ur.active = true
    )
  );

-- ============================================================================
-- DEVICES (Location-scoped)
-- ============================================================================

-- Devices: Users can access devices for their locations
CREATE POLICY "music_v2_devices_select" ON music_v2_devices
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN music_v2_locations loc ON loc.business_id = ur.business_id
      WHERE ur.user_id = auth.uid()
      AND loc.id = music_v2_devices.location_id
      AND ur.active = true
    )
  );

CREATE POLICY "music_v2_devices_insert" ON music_v2_devices
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN music_v2_locations loc ON loc.business_id = ur.business_id
      WHERE ur.user_id = auth.uid()
      AND loc.id = music_v2_devices.location_id
      AND ur.role IN ('owner', 'admin', 'manager')
      AND ur.active = true
    )
  );

CREATE POLICY "music_v2_devices_update" ON music_v2_devices
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN music_v2_locations loc ON loc.business_id = ur.business_id
      WHERE ur.user_id = auth.uid()
      AND loc.id = music_v2_devices.location_id
      AND ur.role IN ('owner', 'admin', 'manager')
      AND ur.active = true
    )
  );

-- Device token authentication (for desktop app auto-login)
CREATE POLICY "music_v2_devices_device_auth" ON music_v2_devices
  FOR SELECT
  USING (
    -- Allow device to read its own record via token
    device_token IS NOT NULL
    AND device_token = current_setting('app.device_token', true)
  );

-- ============================================================================
-- PLAYLISTS & TRACKS
-- ============================================================================

-- Curated Playlists: Everyone can read active playlists
CREATE POLICY "music_v2_curated_playlists_select" ON music_v2_curated_playlists
  FOR SELECT
  USING (is_active = true);

CREATE POLICY "music_v2_curated_playlists_admin_insert" ON music_v2_curated_playlists
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin')
      AND ur.active = true
    )
  );

CREATE POLICY "music_v2_curated_playlists_admin_update" ON music_v2_curated_playlists
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin')
      AND ur.active = true
    )
  );

CREATE POLICY "music_v2_curated_playlists_admin_delete" ON music_v2_curated_playlists
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin')
      AND ur.active = true
    )
  );

-- Playlist Tracks: Read with playlist access
CREATE POLICY "music_v2_playlist_tracks_select" ON music_v2_playlist_tracks
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM music_v2_curated_playlists p
      WHERE p.id = music_v2_playlist_tracks.playlist_id
      AND p.is_active = true
    )
  );

-- Global Tracks: Everyone can read approved tracks
CREATE POLICY "music_v2_global_tracks_select" ON music_v2_global_tracks
  FOR SELECT
  USING (status = 'approved');

CREATE POLICY "music_v2_global_tracks_admin_insert" ON music_v2_global_tracks
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin')
      AND ur.active = true
    )
  );

CREATE POLICY "music_v2_global_tracks_admin_update" ON music_v2_global_tracks
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin')
      AND ur.active = true
    )
  );

CREATE POLICY "music_v2_global_tracks_admin_delete" ON music_v2_global_tracks
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin')
      AND ur.active = true
    )
  );

-- Location Blacklist: Location-scoped
CREATE POLICY "music_v2_location_blacklist_select" ON music_v2_location_blacklist
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN music_v2_locations loc ON loc.business_id = ur.business_id
      WHERE ur.user_id = auth.uid()
      AND loc.id = music_v2_location_blacklist.location_id
      AND ur.active = true
    )
  );

CREATE POLICY "music_v2_location_blacklist_insert" ON music_v2_location_blacklist
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN music_v2_locations loc ON loc.business_id = ur.business_id
      WHERE ur.user_id = auth.uid()
      AND loc.id = music_v2_location_blacklist.location_id
      AND ur.role IN ('owner', 'admin', 'manager')
      AND ur.active = true
    )
  );

-- ============================================================================
-- SCHEDULING
-- ============================================================================

-- Schedule Blocks: Location-scoped
CREATE POLICY "music_v2_schedule_blocks_select" ON music_v2_schedule_blocks
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN music_v2_locations loc ON loc.business_id = ur.business_id
      WHERE ur.user_id = auth.uid()
      AND loc.id = music_v2_schedule_blocks.location_id
      AND ur.active = true
    )
  );

CREATE POLICY "music_v2_schedule_blocks_modify" ON music_v2_schedule_blocks
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN music_v2_locations loc ON loc.business_id = ur.business_id
      WHERE ur.user_id = auth.uid()
      AND loc.id = music_v2_schedule_blocks.location_id
      AND ur.role IN ('owner', 'admin', 'manager')
      AND ur.active = true
    )
  );

-- CEO Rules: Location-scoped
CREATE POLICY "music_v2_ceo_rules_select" ON music_v2_ceo_rules
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN music_v2_locations loc ON loc.business_id = ur.business_id
      WHERE ur.user_id = auth.uid()
      AND loc.id = music_v2_ceo_rules.location_id
      AND ur.active = true
    )
  );

CREATE POLICY "music_v2_ceo_rules_modify" ON music_v2_ceo_rules
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN music_v2_locations loc ON loc.business_id = ur.business_id
      WHERE ur.user_id = auth.uid()
      AND loc.id = music_v2_ceo_rules.location_id
      AND ur.role IN ('owner', 'admin', 'manager')
      AND ur.active = true
    )
  );

-- ============================================================================
-- PLAYBACK LOGS (Location-scoped, device can write)
-- ============================================================================

-- Playback Logs: Location users can read, devices can write
CREATE POLICY "music_v2_playback_logs_select" ON music_v2_playback_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN music_v2_locations loc ON loc.business_id = ur.business_id
      WHERE ur.user_id = auth.uid()
      AND loc.id = music_v2_playback_logs.location_id
      AND ur.active = true
    )
  );

CREATE POLICY "music_v2_playback_logs_device_insert" ON music_v2_playback_logs
  FOR INSERT
  WITH CHECK (
    -- Device can insert via token
    EXISTS (
      SELECT 1 FROM music_v2_devices d
      WHERE d.id = music_v2_playback_logs.device_id
      AND d.device_token = current_setting('app.device_token', true)
    )
  );

-- ============================================================================
-- ADS & CAMPAIGNS
-- ============================================================================

-- Ad Campaigns: Advertisers see their own, locations see targeting them
CREATE POLICY "music_v2_ad_campaigns_select_advertiser" ON music_v2_ad_campaigns
  FOR SELECT
  USING (
    advertiser_id = auth.uid()
    OR status IN ('approved', 'active')
  );

CREATE POLICY "music_v2_ad_campaigns_insert" ON music_v2_ad_campaigns
  FOR INSERT
  WITH CHECK (advertiser_id = auth.uid());

CREATE POLICY "music_v2_ad_campaigns_update_advertiser" ON music_v2_ad_campaigns
  FOR UPDATE
  USING (advertiser_id = auth.uid());

-- Admin can approve/reject
CREATE POLICY "music_v2_ad_campaigns_admin_update" ON music_v2_ad_campaigns
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin')
      AND ur.active = true
    )
  );

CREATE POLICY "music_v2_ad_campaigns_admin_delete" ON music_v2_ad_campaigns
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin')
      AND ur.active = true
    )
  );

-- Ad Impressions: Devices can write, locations can read
CREATE POLICY "music_v2_ad_impressions_select" ON music_v2_ad_impressions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN music_v2_locations loc ON loc.business_id = ur.business_id
      WHERE ur.user_id = auth.uid()
      AND loc.id = music_v2_ad_impressions.location_id
      AND ur.active = true
    )
  );

CREATE POLICY "music_v2_ad_impressions_device_insert" ON music_v2_ad_impressions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM music_v2_devices d
      WHERE d.id = music_v2_ad_impressions.device_id
      AND d.device_token = current_setting('app.device_token', true)
    )
  );

-- ============================================================================
-- REVENUE & BILLING (Location-scoped, sensitive)
-- ============================================================================

-- Revenue Calculations: Location owners/admins only
CREATE POLICY "music_v2_revenue_calculations_select" ON music_v2_revenue_calculations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN music_v2_locations loc ON loc.business_id = ur.business_id
      WHERE ur.user_id = auth.uid()
      AND loc.id = music_v2_revenue_calculations.location_id
      AND ur.role IN ('owner', 'admin')
      AND ur.active = true
    )
  );

-- Stripe Subscriptions: Location owners/admins only
CREATE POLICY "music_v2_stripe_subscriptions_select" ON music_v2_stripe_subscriptions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN music_v2_locations loc ON loc.business_id = ur.business_id
      WHERE ur.user_id = auth.uid()
      AND loc.id = music_v2_stripe_subscriptions.location_id
      AND ur.role IN ('owner', 'admin')
      AND ur.active = true
    )
  );

-- Stripe Connect: Tenant owners only
CREATE POLICY "music_v2_stripe_connect_accounts_select" ON music_v2_stripe_connect_accounts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.business_id = music_v2_stripe_connect_accounts.tenant_id
      AND ur.role IN ('owner', 'admin')
      AND ur.active = true
    )
  );

-- ============================================================================
-- ANNOUNCEMENTS (Location-scoped)
-- ============================================================================

-- Announcements: Location users can read/write
CREATE POLICY "music_v2_announcements_select" ON music_v2_announcements
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN music_v2_locations loc ON loc.business_id = ur.business_id
      WHERE ur.user_id = auth.uid()
      AND loc.id = music_v2_announcements.location_id
      AND ur.active = true
    )
  );

CREATE POLICY "music_v2_announcements_modify" ON music_v2_announcements
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN music_v2_locations loc ON loc.business_id = ur.business_id
      WHERE ur.user_id = auth.uid()
      AND loc.id = music_v2_announcements.location_id
      AND ur.role IN ('owner', 'admin', 'manager')
      AND ur.active = true
    )
  );

-- ============================================================================
-- ISSUE REPORTS (Location-scoped)
-- ============================================================================

-- Issue Reports: Location users can read/write
CREATE POLICY "music_v2_issue_reports_select" ON music_v2_issue_reports
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN music_v2_locations loc ON loc.business_id = ur.business_id
      WHERE ur.user_id = auth.uid()
      AND loc.id = music_v2_issue_reports.location_id
      AND ur.active = true
    )
  );

CREATE POLICY "music_v2_issue_reports_insert" ON music_v2_issue_reports
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN music_v2_locations loc ON loc.business_id = ur.business_id
      WHERE ur.user_id = auth.uid()
      AND loc.id = music_v2_issue_reports.location_id
      AND ur.active = true
    )
  );

-- Admin can update (take action)
CREATE POLICY "music_v2_issue_reports_admin_update" ON music_v2_issue_reports
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin')
      AND ur.active = true
    )
  );

