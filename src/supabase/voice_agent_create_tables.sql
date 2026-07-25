-- Voice Agent Module - Database Schema
-- AI Voice Agent system for Tavari

-- Table: voice_agents
-- Stores AI voice agent configurations per business
CREATE TABLE IF NOT EXISTS voice_agents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text,
    industry_type text, -- 'fec', 'restaurant', 'medical', 'salon', 'contractor', 'custom'
    
    -- Vapi Configuration
    vapi_assistant_id text, -- Vapi assistant ID
    vapi_phone_number_id text, -- Vapi phone number ID
    
    -- Phone Configuration
    phone_number text, -- Telnyx phone number
    telnyx_connection_id text,
    
    -- Agent Configuration
    system_prompt text NOT NULL,
    first_message text,
    voice_provider text DEFAULT '11labs', -- '11labs', 'openai', etc.
    voice_id text DEFAULT 'jennifer',
    model_provider text DEFAULT 'openai',
    model_name text DEFAULT 'gpt-4o-mini',
    temperature numeric DEFAULT 0.7,
    max_tokens integer DEFAULT 250,
    
    -- Business Information (for prompt customization)
    business_name text,
    business_hours text,
    business_address text,
    business_phone text,
    
    -- Services/Pricing (JSONB for flexibility)
    services_config jsonb, -- Industry-specific services and pricing
    functions_config jsonb, -- Available functions (check_availability, capture_lead, etc.)
    
    -- Status
    is_active boolean DEFAULT false,
    is_enabled boolean DEFAULT true,
    
    -- Metadata
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    
    CONSTRAINT voice_agents_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE
);

-- Table: voice_agent_calls
-- Stores call records and analytics
CREATE TABLE IF NOT EXISTS voice_agent_calls (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    agent_id uuid NOT NULL REFERENCES voice_agents(id) ON DELETE CASCADE,
    
    -- Call Information
    vapi_call_id text UNIQUE, -- Vapi call ID
    phone_number text, -- Customer phone number
    direction text, -- 'inbound' or 'outbound'
    status text, -- 'queued', 'ringing', 'in-progress', 'completed', 'failed', 'busy', 'no-answer', 'canceled'
    
    -- Call Details
    started_at timestamptz,
    ended_at timestamptz,
    duration_seconds integer,
    recording_url text,
    transcript text,
    
    -- Analytics
    was_answered boolean DEFAULT false,
    was_transferred boolean DEFAULT false,
    transfer_reason text,
    booking_captured boolean DEFAULT false,
    lead_captured boolean DEFAULT false,
    
    -- Metadata
    metadata jsonb, -- Additional call data from Vapi
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Table: voice_agent_leads
-- Stores leads captured from calls
CREATE TABLE IF NOT EXISTS voice_agent_leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    agent_id uuid NOT NULL REFERENCES voice_agents(id) ON DELETE CASCADE,
    call_id uuid REFERENCES voice_agent_calls(id) ON DELETE SET NULL,
    
    -- Lead Information
    name text,
    phone text,
    email text,
    event_type text, -- 'birthday', 'group', 'corporate', 'appointment', etc.
    preferred_date date,
    preferred_time time,
    guest_count integer,
    notes text,
    
    -- Status
    status text DEFAULT 'new', -- 'new', 'contacted', 'booked', 'lost', 'converted'
    assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    
    -- Follow-up
    follow_up_at timestamptz,
    follow_up_completed boolean DEFAULT false,
    
    -- Metadata
    source_data jsonb, -- Raw data from function call
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Table: voice_agent_configurations
-- Stores business-specific voice agent settings
CREATE TABLE IF NOT EXISTS voice_agent_configurations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    
    -- API Credentials (encrypted)
    vapi_api_key_encrypted text, -- Encrypted Vapi API key
    telnyx_api_key_encrypted text, -- Encrypted Telnyx API key
    
    -- Webhook Configuration
    webhook_url text, -- Server URL for webhooks
    
    -- Default Settings
    default_voice_provider text DEFAULT '11labs',
    default_voice_id text DEFAULT 'jennifer',
    default_model text DEFAULT 'gpt-4o-mini',
    
    -- Notification Settings
    notify_on_new_lead boolean DEFAULT true,
    notify_on_call_failed boolean DEFAULT false,
    notification_email text,
    notification_sms text,
    
    -- Metadata
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    
    CONSTRAINT voice_agent_configurations_business_id_unique 
        UNIQUE (business_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_voice_agents_business_id 
    ON voice_agents(business_id);

CREATE INDEX IF NOT EXISTS idx_voice_agents_active 
    ON voice_agents(business_id, is_active) 
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_voice_agent_calls_business_id 
    ON voice_agent_calls(business_id);

CREATE INDEX IF NOT EXISTS idx_voice_agent_calls_agent_id 
    ON voice_agent_calls(agent_id);

CREATE INDEX IF NOT EXISTS idx_voice_agent_calls_vapi_call_id 
    ON voice_agent_calls(vapi_call_id) 
    WHERE vapi_call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_voice_agent_calls_created_at 
    ON voice_agent_calls(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_agent_leads_business_id 
    ON voice_agent_leads(business_id);

CREATE INDEX IF NOT EXISTS idx_voice_agent_leads_agent_id 
    ON voice_agent_leads(agent_id);

CREATE INDEX IF NOT EXISTS idx_voice_agent_leads_status 
    ON voice_agent_leads(business_id, status);

CREATE INDEX IF NOT EXISTS idx_voice_agent_leads_follow_up 
    ON voice_agent_leads(business_id, follow_up_at) 
    WHERE follow_up_at IS NOT NULL AND follow_up_completed = false;

-- Enable RLS
ALTER TABLE voice_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_agent_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_agent_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_agent_configurations ENABLE ROW LEVEL SECURITY;

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_voice_agent_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers
CREATE TRIGGER voice_agents_updated_at
    BEFORE UPDATE ON voice_agents
    FOR EACH ROW
    EXECUTE FUNCTION update_voice_agent_updated_at();

CREATE TRIGGER voice_agent_calls_updated_at
    BEFORE UPDATE ON voice_agent_calls
    FOR EACH ROW
    EXECUTE FUNCTION update_voice_agent_updated_at();

CREATE TRIGGER voice_agent_leads_updated_at
    BEFORE UPDATE ON voice_agent_leads
    FOR EACH ROW
    EXECUTE FUNCTION update_voice_agent_updated_at();

CREATE TRIGGER voice_agent_configurations_updated_at
    BEFORE UPDATE ON voice_agent_configurations
    FOR EACH ROW
    EXECUTE FUNCTION update_voice_agent_updated_at();

-- Comments
COMMENT ON TABLE voice_agents IS 'AI voice agent configurations for businesses';
COMMENT ON TABLE voice_agent_calls IS 'Call records and analytics for voice agents';
COMMENT ON TABLE voice_agent_leads IS 'Leads captured from voice agent calls';
COMMENT ON TABLE voice_agent_configurations IS 'Business-level voice agent settings and credentials';


