-- ============================================================================
-- Add Issue Notification Email Configuration
-- ============================================================================
-- This adds a separate email field for issue notifications so businesses
-- can configure different emails for different notification types.

-- Add issue_notification_email column to voice_agents table
ALTER TABLE voice_agents 
ADD COLUMN IF NOT EXISTS issue_notification_email text;

COMMENT ON COLUMN voice_agents.issue_notification_email IS 'Email address for receiving AI-identified issues and knowledge gaps (falls back to message_notification_email if not set)';

