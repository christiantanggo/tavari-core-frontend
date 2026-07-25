-- Create user_recent_activity table for tracking recently accessed items
CREATE TABLE IF NOT EXISTS user_recent_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  item_type TEXT NOT NULL, -- 'dashboard', 'playlist', 'campaign', etc.
  item_id UUID,
  item_name TEXT,
  accessed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, business_id, module_key, item_type, item_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_recent_activity_user_business 
  ON user_recent_activity(user_id, business_id, accessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_recent_activity_module 
  ON user_recent_activity(module_key, accessed_at DESC);

-- Enable RLS
ALTER TABLE user_recent_activity ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own recent activity"
  ON user_recent_activity
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own recent activity"
  ON user_recent_activity
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own recent activity"
  ON user_recent_activity
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own recent activity"
  ON user_recent_activity
  FOR DELETE
  USING (auth.uid() = user_id);

-- Add comments
COMMENT ON TABLE user_recent_activity IS 'Tracks recently accessed items per user for quick navigation';
COMMENT ON COLUMN user_recent_activity.item_type IS 'Type of item: dashboard, playlist, campaign, etc.';



