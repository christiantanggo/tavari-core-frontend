-- ============================================================================
-- Music V2 Module - Fix RLS Policies
-- ============================================================================
-- This fixes RLS policies that were using FOR ALL, which conflicts with
-- FOR SELECT policies. Changes FOR ALL to separate INSERT, UPDATE, DELETE policies.
-- ============================================================================

-- Drop ALL existing admin policies (we'll recreate them)
DROP POLICY IF EXISTS "music_v2_plans_admin_all" ON music_v2_plans;
DROP POLICY IF EXISTS "music_v2_plans_admin_modify" ON music_v2_plans;
DROP POLICY IF EXISTS "music_v2_plans_admin_insert" ON music_v2_plans;
DROP POLICY IF EXISTS "music_v2_plans_admin_update" ON music_v2_plans;
DROP POLICY IF EXISTS "music_v2_plans_admin_delete" ON music_v2_plans;

DROP POLICY IF EXISTS "music_v2_pricing_matrix_admin_all" ON music_v2_pricing_matrix;
DROP POLICY IF EXISTS "music_v2_pricing_matrix_admin_modify" ON music_v2_pricing_matrix;
DROP POLICY IF EXISTS "music_v2_pricing_matrix_admin_insert" ON music_v2_pricing_matrix;
DROP POLICY IF EXISTS "music_v2_pricing_matrix_admin_update" ON music_v2_pricing_matrix;
DROP POLICY IF EXISTS "music_v2_pricing_matrix_admin_delete" ON music_v2_pricing_matrix;

DROP POLICY IF EXISTS "music_v2_curated_playlists_admin_all" ON music_v2_curated_playlists;
DROP POLICY IF EXISTS "music_v2_curated_playlists_admin_modify" ON music_v2_curated_playlists;
DROP POLICY IF EXISTS "music_v2_curated_playlists_admin_insert" ON music_v2_curated_playlists;
DROP POLICY IF EXISTS "music_v2_curated_playlists_admin_update" ON music_v2_curated_playlists;
DROP POLICY IF EXISTS "music_v2_curated_playlists_admin_delete" ON music_v2_curated_playlists;

DROP POLICY IF EXISTS "music_v2_global_tracks_admin_all" ON music_v2_global_tracks;
DROP POLICY IF EXISTS "music_v2_global_tracks_admin_modify" ON music_v2_global_tracks;
DROP POLICY IF EXISTS "music_v2_global_tracks_admin_insert" ON music_v2_global_tracks;
DROP POLICY IF EXISTS "music_v2_global_tracks_admin_update" ON music_v2_global_tracks;
DROP POLICY IF EXISTS "music_v2_global_tracks_admin_delete" ON music_v2_global_tracks;

DROP POLICY IF EXISTS "music_v2_ad_campaigns_admin_all" ON music_v2_ad_campaigns;
DROP POLICY IF EXISTS "music_v2_ad_campaigns_admin_modify" ON music_v2_ad_campaigns;
DROP POLICY IF EXISTS "music_v2_ad_campaigns_admin_update" ON music_v2_ad_campaigns;
DROP POLICY IF EXISTS "music_v2_ad_campaigns_admin_delete" ON music_v2_ad_campaigns;

-- Recreate with separate policies for each operation
-- Plans: Admin can insert, update, delete
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

-- Pricing Matrix: Admin can insert, update, delete
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

-- Curated Playlists: Admin can insert, update, delete
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

-- Global Tracks: Admin can insert, update, delete
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

-- Ad Campaigns: Admin can update, delete (insert handled by advertiser)
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

