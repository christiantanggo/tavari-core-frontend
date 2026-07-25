-- Voice Agent Logs Table
-- Stores all logs from webhook and voice agent activity

CREATE TABLE IF NOT EXISTS voice_agent_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
    agent_id uuid REFERENCES voice_agents(id) ON DELETE CASCADE,
    call_id uuid REFERENCES voice_agent_calls(id) ON DELETE SET NULL,
    
    -- Log Details
    event_type text NOT NULL, -- e.g., 'function_call', 'email_sent', 'email_failed', 'booking_created', 'error'
    message text NOT NULL,
    details jsonb, -- Additional structured data
    severity text DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error')),
    source text DEFAULT 'webhook', -- 'webhook', 'dashboard', 'api', etc.
    
    -- Timestamps
    created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_voice_agent_logs_business_id 
    ON voice_agent_logs(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_agent_logs_agent_id 
    ON voice_agent_logs(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_agent_logs_event_type 
    ON voice_agent_logs(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_agent_logs_severity 
    ON voice_agent_logs(severity, created_at DESC)
    WHERE severity IN ('warning', 'error');

CREATE INDEX IF NOT EXISTS idx_voice_agent_logs_call_id 
    ON voice_agent_logs(call_id);

-- Enable RLS
ALTER TABLE voice_agent_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view logs for their businesses"
ON voice_agent_logs FOR SELECT
USING (
    business_id IN (
        SELECT business_id FROM user_roles 
        WHERE user_id = auth.uid() 
        AND role IN ('owner', 'manager', 'admin', 'employee')
    )
);

COMMENT ON TABLE voice_agent_logs IS 'Stores all logs from voice agent webhook and activity';
COMMENT ON COLUMN voice_agent_logs.event_type IS 'Type of event: function_call, email_sent, email_failed, booking_created, booking_failed, message_taken, error, etc.';
COMMENT ON COLUMN voice_agent_logs.severity IS 'Log severity level: info, warning, or error';
COMMENT ON COLUMN voice_agent_logs.details IS 'Additional structured data about the event';

