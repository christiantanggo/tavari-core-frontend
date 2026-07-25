-- AI Social Media Agent - Database Schema
-- Multi-business social media automation system

-- 1. Social Media Configurations Table
CREATE TABLE IF NOT EXISTS social_media_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL, -- instagram, facebook, twitter, tiktok
  is_enabled BOOLEAN DEFAULT true,
  
  -- Platform-specific credentials (encrypted in production)
  access_token TEXT,
  access_token_secret TEXT, -- For Twitter
  api_key TEXT,
  api_secret TEXT,
  page_id VARCHAR(255),
  account_id VARCHAR(255),
  
  -- Posting preferences
  posting_enabled BOOLEAN DEFAULT true,
  auto_posting_enabled BOOLEAN DEFAULT true,
  posting_frequency_hours INTEGER DEFAULT 4, -- Hours between posts
  max_posts_per_day INTEGER DEFAULT 6,
  preferred_posting_times JSONB, -- Array of hour ranges [{"start": 9, "end": 17}]
  
  -- Content preferences
  content_style VARCHAR(100), -- casual, professional, energetic, etc.
  include_hashtags BOOLEAN DEFAULT true,
  hashtag_count INTEGER DEFAULT 10,
  include_emoji BOOLEAN DEFAULT true,
  
  -- Rate limiting
  last_posted_at TIMESTAMPTZ,
  posts_today INTEGER DEFAULT 0,
  daily_post_reset_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(business_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_social_configs_business ON social_media_configs(business_id);
CREATE INDEX IF NOT EXISTS idx_social_configs_platform ON social_media_configs(platform);
CREATE INDEX IF NOT EXISTS idx_social_configs_enabled ON social_media_configs(is_enabled, posting_enabled);

-- 2. Content Sources Table (Generic)
CREATE TABLE IF NOT EXISTS content_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source_type VARCHAR(100) NOT NULL, -- deal, product, blog_post, event, etc.
  source_id VARCHAR(255) NOT NULL, -- ID from the source system
  title VARCHAR(500) NOT NULL,
  description TEXT,
  image_urls TEXT[], -- Array of image URLs
  url VARCHAR(1000), -- Link to full content
  metadata JSONB, -- Flexible storage for source-specific data
  
  -- AI-generated fields
  ai_summary TEXT,
  ai_tags TEXT[],
  ai_score INTEGER DEFAULT 0, -- 0-100 quality score
  
  -- Posting rules
  can_post BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0, -- Higher = posted first
  last_posted_at TIMESTAMPTZ,
  times_posted INTEGER DEFAULT 0,
  
  -- Status
  status VARCHAR(50) DEFAULT 'active', -- active, archived, hidden
  expires_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(business_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_content_sources_business ON content_sources(business_id);
CREATE INDEX IF NOT EXISTS idx_content_sources_type ON content_sources(source_type);
CREATE INDEX IF NOT EXISTS idx_content_sources_postable ON content_sources(business_id, can_post, status) 
  WHERE can_post = true AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_content_sources_priority ON content_sources(business_id, priority DESC, ai_score DESC);

-- 3. Social Posts Tracking Table
CREATE TABLE IF NOT EXISTS social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  content_source_id UUID REFERENCES content_sources(id) ON DELETE SET NULL,
  platform VARCHAR(50) NOT NULL,
  
  -- Generated content
  caption TEXT NOT NULL,
  hashtags TEXT[],
  image_url VARCHAR(1000),
  
  -- Posting details
  post_url VARCHAR(1000),
  post_id VARCHAR(255), -- Platform-specific post ID
  status VARCHAR(50) DEFAULT 'draft', -- draft, scheduled, posted, failed
  scheduled_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  
  -- Analytics
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  last_analytics_sync_at TIMESTAMPTZ,
  
  -- Error tracking
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_posts_business ON social_posts(business_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_platform ON social_posts(platform);
CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts(status);
CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled ON social_posts(scheduled_at) 
  WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_social_posts_content_source ON social_posts(content_source_id);

-- 4. Posting Rules & Filters Table
CREATE TABLE IF NOT EXISTS posting_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rule_name VARCHAR(255) NOT NULL,
  rule_type VARCHAR(100) NOT NULL, -- filter, schedule, content_rule
  is_active BOOLEAN DEFAULT true,
  
  -- Rule conditions (JSONB for flexibility)
  conditions JSONB NOT NULL,
  -- Example: {"min_ai_score": 50, "categories": ["electronics"], "exclude_keywords": ["adult"]}
  
  -- Rule actions
  actions JSONB NOT NULL,
  -- Example: {"skip": true} or {"priority": 10, "platforms": ["instagram"]}
  
  priority INTEGER DEFAULT 0, -- Rules applied in priority order
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posting_rules_business ON posting_rules(business_id, is_active);

-- 5. Analytics Summary Table
CREATE TABLE IF NOT EXISTS social_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  date DATE NOT NULL,
  
  -- Metrics
  posts_count INTEGER DEFAULT 0,
  total_views INTEGER DEFAULT 0,
  total_likes INTEGER DEFAULT 0,
  total_comments INTEGER DEFAULT 0,
  total_shares INTEGER DEFAULT 0,
  total_clicks INTEGER DEFAULT 0,
  
  -- Engagement rates
  avg_engagement_rate DECIMAL(5,2),
  avg_click_rate DECIMAL(5,2),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(business_id, platform, date)
);

CREATE INDEX IF NOT EXISTS idx_social_analytics_business ON social_analytics(business_id, date DESC);

-- Add comments for documentation
COMMENT ON TABLE social_media_configs IS 'Stores social media platform configurations and credentials per business';
COMMENT ON TABLE content_sources IS 'Generic content sources that can be posted to social media (deals, products, blog posts, etc.)';
COMMENT ON TABLE social_posts IS 'Tracks all social media posts with analytics and status';
COMMENT ON TABLE posting_rules IS 'Business-specific rules for filtering and scheduling posts';
COMMENT ON TABLE social_analytics IS 'Daily aggregated analytics per business and platform';


