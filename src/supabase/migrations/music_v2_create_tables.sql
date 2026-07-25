-- ============================================================================
-- Music V2 Module - Database Schema
-- ============================================================================
-- This creates the new music revenue share system alongside the existing
-- music system. All tables use music_v2_ prefix to avoid conflicts.
-- ============================================================================

-- ============================================================================
-- PLANS & PRICING
-- ============================================================================

-- Plans (Standard, Plus, Premium)
CREATE TABLE IF NOT EXISTS music_v2_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_key TEXT UNIQUE NOT NULL, -- 'standard', 'plus', 'premium'
  name TEXT NOT NULL,
  description TEXT,
  allows_mainstream BOOLEAN DEFAULT false,
  allows_premium_content BOOLEAN DEFAULT false,
  base_devices_included INTEGER DEFAULT 1,
  price_per_additional_device DECIMAL(10,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pricing Matrix (hard-coded pricing based on plan + ad frequency)
CREATE TABLE IF NOT EXISTS music_v2_pricing_matrix (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID REFERENCES music_v2_plans(id) ON DELETE CASCADE,
  ad_frequency TEXT NOT NULL, -- 'zero_ads', 'one_per_8', 'one_per_7', 'one_per_6', 'one_per_5', 'one_per_4', 'one_per_3'
  pricing_mode TEXT NOT NULL, -- 'fixed_cost' or 'revenue_share'
  pricing_value DECIMAL(10,2) NOT NULL, -- dollars if fixed_cost, percentage if revenue_share
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(plan_id, ad_frequency)
);

-- ============================================================================
-- LOCATIONS & DEVICES
-- ============================================================================

-- Locations (extends businesses - one per physical location)
CREATE TABLE IF NOT EXISTS music_v2_locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES businesses(id) ON DELETE CASCADE, -- Tavari tenant
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE, -- Physical location
  plan_id UUID REFERENCES music_v2_plans(id),
  current_playlist_type TEXT, -- 'upbeat', 'background', 'upscale'
  default_ad_frequency TEXT DEFAULT 'one_per_6',
  playlist_change_behavior TEXT DEFAULT 'after_current_song', -- 'immediate' or 'after_current_song'
  content_rating TEXT DEFAULT 'family', -- 'kids_safe', 'family', 'general'
  music_volume DECIMAL(3,2) DEFAULT 0.70, -- 0.00 to 1.00
  ad_volume DECIMAL(3,2) DEFAULT 0.80, -- 0.00 to 1.00
  auto_start BOOLEAN DEFAULT true,
  kiosk_mode BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id)
);

-- Devices (per physical player)
CREATE TABLE IF NOT EXISTS music_v2_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id UUID REFERENCES music_v2_locations(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL, -- 'Main Bar', 'Dining Room', 'Patio'
  device_type TEXT DEFAULT 'desktop', -- 'desktop', 'tablet'
  device_token TEXT UNIQUE, -- For auto-login
  status TEXT DEFAULT 'offline', -- 'online', 'offline', 'error'
  last_check_in_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- PLAYLISTS & TRACKS
-- ============================================================================

-- Curated Playlists (Tavari-managed)
CREATE TABLE IF NOT EXISTS music_v2_curated_playlists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID REFERENCES music_v2_plans(id) ON DELETE CASCADE,
  playlist_type TEXT NOT NULL, -- 'upbeat', 'background', 'upscale'
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Playlist Tracks (many-to-many)
CREATE TABLE IF NOT EXISTS music_v2_playlist_tracks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  playlist_id UUID REFERENCES music_v2_curated_playlists(id) ON DELETE CASCADE,
  track_id UUID NOT NULL, -- References music_tracks OR music_v2_global_tracks
  track_source TEXT NOT NULL, -- 'business' or 'global'
  track_order INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(playlist_id, track_id, track_source)
);

-- Global Music Library (Tavari-managed)
CREATE TABLE IF NOT EXISTS music_v2_global_tracks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  artist TEXT,
  album TEXT,
  duration INTEGER, -- seconds
  file_path TEXT NOT NULL,
  file_size BIGINT,
  mime_type TEXT DEFAULT 'audio/mpeg',
  
  -- Licensing & Royalty
  isrc_code TEXT,
  publisher TEXT,
  label TEXT,
  royalty_rate DECIMAL(10,4),
  license_type TEXT, -- 'royalty_free', 'licensed', 'purchased'
  license_expires_at TIMESTAMPTZ,
  
  -- Metadata
  genre TEXT,
  bpm INTEGER,
  mood TEXT,
  content_rating TEXT DEFAULT 'family', -- 'kids_safe', 'family', 'general'
  language TEXT,
  explicit_lyrics BOOLEAN DEFAULT false,
  
  -- Admin
  uploaded_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Location Blacklist (tracks/artists business doesn't want)
CREATE TABLE IF NOT EXISTS music_v2_location_blacklist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id UUID REFERENCES music_v2_locations(id) ON DELETE CASCADE,
  track_id UUID, -- Can be business track or global track
  track_source TEXT, -- 'business' or 'global'
  artist_name TEXT, -- For artist-level blocking
  blocked_by UUID REFERENCES users(id),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(location_id, track_id, track_source)
);

-- ============================================================================
-- SCHEDULING
-- ============================================================================

-- Hourly Schedule Blocks
CREATE TABLE IF NOT EXISTS music_v2_schedule_blocks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id UUID REFERENCES music_v2_locations(id) ON DELETE CASCADE,
  day_of_week INTEGER, -- 0=Sunday, 6=Saturday, NULL=all days
  start_hour INTEGER NOT NULL, -- 0-23
  end_hour INTEGER NOT NULL, -- 0-23
  playlist_type TEXT NOT NULL, -- 'upbeat', 'background', 'upscale'
  ad_frequency TEXT, -- NULL = use location default
  content_rating TEXT, -- NULL = use location default
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- CEO Rules (Customer Experience Optimizer)
CREATE TABLE IF NOT EXISTS music_v2_ceo_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id UUID REFERENCES music_v2_locations(id) ON DELETE CASCADE,
  rule_name TEXT NOT NULL,
  condition_type TEXT NOT NULL, -- 'time_range', 'day_of_week', 'operating_hours'
  condition_value JSONB NOT NULL, -- Flexible condition data
  action_playlist_type TEXT NOT NULL,
  action_ad_frequency TEXT,
  action_content_rating TEXT,
  priority INTEGER DEFAULT 0, -- Higher = evaluated first
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- PLAYBACK LOGGING
-- ============================================================================

-- Playback Logs (per device, per song/ad)
CREATE TABLE IF NOT EXISTS music_v2_playback_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id UUID REFERENCES music_v2_devices(id) ON DELETE CASCADE,
  location_id UUID REFERENCES music_v2_locations(id) ON DELETE CASCADE,
  log_type TEXT NOT NULL, -- 'song' or 'ad'
  track_id UUID, -- For songs
  ad_id UUID, -- For ads
  playlist_id UUID REFERENCES music_v2_curated_playlists(id),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  duration_played INTEGER, -- seconds
  completed BOOLEAN DEFAULT false,
  skipped BOOLEAN DEFAULT false,
  synced_to_server BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- ADS & CAMPAIGNS
-- ============================================================================

-- Ad Campaigns (from advertiser portal)
CREATE TABLE IF NOT EXISTS music_v2_ad_campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  advertiser_id UUID REFERENCES users(id),
  campaign_name TEXT NOT NULL,
  audio_file_path TEXT NOT NULL,
  duration INTEGER, -- seconds
  targeting_locations JSONB, -- Array of location_ids
  targeting_categories JSONB, -- Array of business categories
  targeting_geography JSONB, -- Country, region, city
  budget DECIMAL(10,2),
  pricing_model TEXT, -- 'cpm', 'package', 'flat'
  pricing_value DECIMAL(10,2),
  status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'active', 'paused', 'completed', 'rejected'
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ad Impressions (for revenue tracking)
CREATE TABLE IF NOT EXISTS music_v2_ad_impressions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID REFERENCES music_v2_ad_campaigns(id) ON DELETE CASCADE,
  device_id UUID REFERENCES music_v2_devices(id) ON DELETE CASCADE,
  location_id UUID REFERENCES music_v2_locations(id) ON DELETE CASCADE,
  played_at TIMESTAMPTZ NOT NULL,
  duration_played INTEGER,
  completed BOOLEAN DEFAULT false,
  revenue_amount DECIMAL(10,4), -- Calculated CPM
  synced_to_server BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- REVENUE & BILLING
-- ============================================================================

-- Revenue Calculations (monthly rollups)
CREATE TABLE IF NOT EXISTS music_v2_revenue_calculations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id UUID REFERENCES music_v2_locations(id) ON DELETE CASCADE,
  device_id UUID REFERENCES music_v2_devices(id) ON DELETE CASCADE,
  calculation_month DATE NOT NULL, -- First day of month
  total_songs_played INTEGER DEFAULT 0,
  total_ads_played INTEGER DEFAULT 0,
  effective_ratio DECIMAL(5,2), -- songs/ads
  effective_ad_frequency TEXT, -- Mapped bracket
  total_ad_revenue DECIMAL(10,2) DEFAULT 0,
  business_share DECIMAL(10,2) DEFAULT 0,
  tavari_share DECIMAL(10,2) DEFAULT 0,
  subscription_cost DECIMAL(10,2) DEFAULT 0,
  net_payout DECIMAL(10,2) DEFAULT 0, -- Positive = payout, Negative = charge
  stripe_payout_id TEXT,
  payout_status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'paid', 'failed'
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(location_id, device_id, calculation_month)
);

-- Stripe Subscriptions
CREATE TABLE IF NOT EXISTS music_v2_stripe_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id UUID REFERENCES music_v2_locations(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT UNIQUE NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  plan_id UUID REFERENCES music_v2_plans(id),
  status TEXT NOT NULL, -- 'active', 'canceled', 'past_due'
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stripe Connect Accounts (for payouts)
CREATE TABLE IF NOT EXISTS music_v2_stripe_connect_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  stripe_account_id TEXT UNIQUE NOT NULL,
  account_status TEXT, -- 'pending', 'active', 'restricted'
  payouts_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- ANNOUNCEMENTS
-- ============================================================================

-- Announcements
CREATE TABLE IF NOT EXISTS music_v2_announcements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id UUID REFERENCES music_v2_locations(id) ON DELETE CASCADE,
  device_id UUID REFERENCES music_v2_devices(id) ON DELETE SET NULL, -- NULL = all devices
  announcement_type TEXT NOT NULL, -- 'closing_15min', 'closed', 'custom', 'scheduled'
  text_content TEXT NOT NULL,
  audio_file_path TEXT, -- Generated TTS or uploaded
  scheduled_time TIMESTAMPTZ, -- NULL = play immediately
  is_recurring BOOLEAN DEFAULT false,
  recurrence_pattern JSONB, -- Daily, weekly, etc.
  volume_ducking BOOLEAN DEFAULT true,
  played_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- ISSUE REPORTING
-- ============================================================================

-- Issue Reports
CREATE TABLE IF NOT EXISTS music_v2_issue_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id UUID REFERENCES music_v2_locations(id) ON DELETE CASCADE,
  device_id UUID REFERENCES music_v2_devices(id) ON DELETE SET NULL,
  reported_by UUID REFERENCES users(id),
  report_type TEXT NOT NULL, -- 'song', 'ad'
  track_id UUID,
  ad_id UUID,
  reason TEXT NOT NULL, -- 'bad_language', 'off_brand', 'technical', 'complaint'
  details TEXT,
  action_taken TEXT, -- 'removed_globally', 'removed_from_location', 'reinstated'
  action_taken_by UUID REFERENCES users(id),
  action_taken_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_music_v2_locations_business ON music_v2_locations(business_id);
CREATE INDEX IF NOT EXISTS idx_music_v2_locations_tenant ON music_v2_locations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_music_v2_devices_location ON music_v2_devices(location_id);
CREATE INDEX IF NOT EXISTS idx_music_v2_devices_token ON music_v2_devices(device_token);
CREATE INDEX IF NOT EXISTS idx_music_v2_playlist_tracks_playlist ON music_v2_playlist_tracks(playlist_id);
CREATE INDEX IF NOT EXISTS idx_music_v2_playlist_tracks_track ON music_v2_playlist_tracks(track_id, track_source);
CREATE INDEX IF NOT EXISTS idx_music_v2_global_tracks_status ON music_v2_global_tracks(status, content_rating);
CREATE INDEX IF NOT EXISTS idx_music_v2_schedule_blocks_location ON music_v2_schedule_blocks(location_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_music_v2_ceo_rules_location ON music_v2_ceo_rules(location_id, is_active);
CREATE INDEX IF NOT EXISTS idx_music_v2_playback_logs_device ON music_v2_playback_logs(device_id, start_time);
CREATE INDEX IF NOT EXISTS idx_music_v2_playback_logs_location ON music_v2_playback_logs(location_id, start_time);
CREATE INDEX IF NOT EXISTS idx_music_v2_playback_logs_synced ON music_v2_playback_logs(synced_to_server, created_at);
CREATE INDEX IF NOT EXISTS idx_music_v2_ad_campaigns_status ON music_v2_ad_campaigns(status, started_at);
CREATE INDEX IF NOT EXISTS idx_music_v2_ad_impressions_campaign ON music_v2_ad_impressions(campaign_id, played_at);
CREATE INDEX IF NOT EXISTS idx_music_v2_revenue_calc_location ON music_v2_revenue_calculations(location_id, calculation_month);
CREATE INDEX IF NOT EXISTS idx_music_v2_revenue_calc_device ON music_v2_revenue_calculations(device_id, calculation_month);

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE music_v2_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_v2_pricing_matrix ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_v2_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_v2_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_v2_curated_playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_v2_playlist_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_v2_global_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_v2_location_blacklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_v2_schedule_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_v2_ceo_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_v2_playback_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_v2_ad_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_v2_ad_impressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_v2_revenue_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_v2_stripe_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_v2_stripe_connect_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_v2_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_v2_issue_reports ENABLE ROW LEVEL SECURITY;

-- RLS Policies will be created in a separate file for better organization
-- See: music_v2_create_rls_policies.sql


