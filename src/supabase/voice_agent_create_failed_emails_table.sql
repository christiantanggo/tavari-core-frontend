-- Voice Agent Failed Emails Table
-- Stores failed email attempts for retry and manual review

CREATE TABLE IF NOT EXISTS voice_agent_failed_emails (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
    agent_id uuid REFERENCES voice_agents(id) ON DELETE CASCADE,
    call_id uuid REFERENCES voice_agent_calls(id) ON DELETE SET NULL,
    message_id uuid REFERENCES voice_agent_messages(id) ON DELETE SET NULL,
    booking_id uuid REFERENCES voice_agent_bookings(id) ON DELETE SET NULL,
    
    -- Email Details
    email_type text NOT NULL CHECK (email_type IN ('message_notification', 'callback_booking', 'issue_report')),
    recipient_email text NOT NULL,
    subject text NOT NULL,
    body_html text,
    body_text text,
    
    -- Failure Details
    error_message text NOT NULL,
    error_code text,
    retry_count integer DEFAULT 0,
    max_retries integer DEFAULT 3,
    status text DEFAULT 'pending' CHECK (status IN ('pending', 'retrying', 'failed', 'sent')),
    last_attempt_at timestamptz,
    next_retry_at timestamptz,
    sent_at timestamptz,
    
    -- Metadata
    context_data jsonb, -- Original context (caller info, booking details, etc.)
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_voice_agent_failed_emails_business_id 
    ON voice_agent_failed_emails(business_id, status, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_voice_agent_failed_emails_status 
    ON voice_agent_failed_emails(status, next_retry_at)
    WHERE status IN ('pending', 'retrying');

CREATE INDEX IF NOT EXISTS idx_voice_agent_failed_emails_agent_id 
    ON voice_agent_failed_emails(agent_id, created_at DESC);

-- Enable RLS
ALTER TABLE voice_agent_failed_emails ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view failed emails for their businesses"
ON voice_agent_failed_emails FOR SELECT
USING (
    business_id IN (
        SELECT business_id FROM user_roles 
        WHERE user_id = auth.uid() 
        AND role IN ('owner', 'manager', 'admin')
    )
);

CREATE POLICY "System can manage failed emails"
ON voice_agent_failed_emails FOR ALL
USING (true)
WITH CHECK (true);

COMMENT ON TABLE voice_agent_failed_emails IS 'Stores failed email attempts for retry and monitoring';
COMMENT ON COLUMN voice_agent_failed_emails.status IS 'pending: waiting for retry, retrying: currently being retried, failed: exceeded max retries, sent: successfully sent on retry';

