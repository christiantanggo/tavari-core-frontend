-- Voice Agent Module - Database Schema (Safe - Handles Existing Objects)
-- This script safely creates tables, indexes, constraints, and policies
-- It will skip objects that already exist

-- Table: voice_agents
CREATE TABLE IF NOT EXISTS voice_agents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    industry_type text,
    
    -- Vapi Configuration
    vapi_assistant_id text,
    vapi_phone_number_id text,
    
    -- Phone Configuration
    phone_number text,
    telnyx_connection_id text,
    
    -- Agent Configuration
    system_prompt text NOT NULL,
    first_message text,
    voice_provider text DEFAULT '11labs',
    voice_id text DEFAULT 'jennifer',
    model_provider text DEFAULT 'openai',
    model_name text DEFAULT 'gpt-4',
    temperature numeric DEFAULT 0.7,
    max_tokens integer DEFAULT 250,
    
    -- Business Information
    business_name text,
    business_hours text,
    business_address text,
    business_phone text,
    
    -- Services/Pricing (JSONB)
    services_config jsonb,
    functions_config jsonb,
    
    -- Status
    is_active boolean DEFAULT false,
    is_enabled boolean DEFAULT true,
    
    -- Metadata
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Add foreign key constraint if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'voice_agents_business_id_fkey'
    ) THEN
        ALTER TABLE voice_agents 
        ADD CONSTRAINT voice_agents_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE;
    END IF;
END $$;

-- Table: voice_agent_calls
CREATE TABLE IF NOT EXISTS voice_agent_calls (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    
    -- Call Information
    vapi_call_id text UNIQUE,
    phone_number text,
    direction text,
    status text,
    
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
    metadata jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Add foreign key constraints if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'voice_agent_calls_business_id_fkey'
    ) THEN
        ALTER TABLE voice_agent_calls 
        ADD CONSTRAINT voice_agent_calls_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'voice_agent_calls_agent_id_fkey'
    ) THEN
        ALTER TABLE voice_agent_calls 
        ADD CONSTRAINT voice_agent_calls_agent_id_fkey 
        FOREIGN KEY (agent_id) 
        REFERENCES voice_agents(id) 
        ON DELETE CASCADE;
    END IF;
END $$;

-- Table: voice_agent_leads
CREATE TABLE IF NOT EXISTS voice_agent_leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    call_id uuid,
    
    -- Lead Information
    name text,
    phone text,
    email text,
    event_type text,
    preferred_date date,
    preferred_time time,
    guest_count integer,
    notes text,
    
    -- Status
    status text DEFAULT 'new',
    assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    
    -- Follow-up
    follow_up_at timestamptz,
    follow_up_completed boolean DEFAULT false,
    
    -- Metadata
    source_data jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Add foreign key constraints if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'voice_agent_leads_business_id_fkey'
    ) THEN
        ALTER TABLE voice_agent_leads 
        ADD CONSTRAINT voice_agent_leads_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'voice_agent_leads_agent_id_fkey'
    ) THEN
        ALTER TABLE voice_agent_leads 
        ADD CONSTRAINT voice_agent_leads_agent_id_fkey 
        FOREIGN KEY (agent_id) 
        REFERENCES voice_agents(id) 
        ON DELETE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'voice_agent_leads_call_id_fkey'
    ) THEN
        ALTER TABLE voice_agent_leads 
        ADD CONSTRAINT voice_agent_leads_call_id_fkey 
        FOREIGN KEY (call_id) 
        REFERENCES voice_agent_calls(id) 
        ON DELETE SET NULL;
    END IF;
END $$;

-- Table: voice_agent_configurations
CREATE TABLE IF NOT EXISTS voice_agent_configurations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    
    -- API Credentials (encrypted)
    vapi_api_key_encrypted text,
    telnyx_api_key_encrypted text,
    
    -- Webhook Configuration
    webhook_url text,
    
    -- Default Settings
    default_voice_provider text DEFAULT '11labs',
    default_voice_id text DEFAULT 'jennifer',
    default_model text DEFAULT 'gpt-4',
    
    -- Notification Settings
    notify_on_new_lead boolean DEFAULT true,
    notify_on_call_failed boolean DEFAULT false,
    notification_email text,
    notification_sms text,
    
    -- Metadata
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Add unique constraint if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'voice_agent_configurations_business_id_unique'
    ) THEN
        ALTER TABLE voice_agent_configurations 
        ADD CONSTRAINT voice_agent_configurations_business_id_unique 
        UNIQUE (business_id);
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'voice_agent_configurations_business_id_fkey'
    ) THEN
        ALTER TABLE voice_agent_configurations 
        ADD CONSTRAINT voice_agent_configurations_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE;
    END IF;
END $$;

-- Create indexes (IF NOT EXISTS doesn't work for indexes, so we check first)
DO $$
BEGIN
    -- voice_agents indexes
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_voice_agents_business_id') THEN
        CREATE INDEX idx_voice_agents_business_id ON voice_agents(business_id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_voice_agents_active') THEN
        CREATE INDEX idx_voice_agents_active ON voice_agents(business_id, is_active) WHERE is_active = true;
    END IF;
    
    -- voice_agent_calls indexes
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_voice_agent_calls_business_id') THEN
        CREATE INDEX idx_voice_agent_calls_business_id ON voice_agent_calls(business_id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_voice_agent_calls_agent_id') THEN
        CREATE INDEX idx_voice_agent_calls_agent_id ON voice_agent_calls(agent_id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_voice_agent_calls_vapi_call_id') THEN
        CREATE INDEX idx_voice_agent_calls_vapi_call_id ON voice_agent_calls(vapi_call_id) WHERE vapi_call_id IS NOT NULL;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_voice_agent_calls_created_at') THEN
        CREATE INDEX idx_voice_agent_calls_created_at ON voice_agent_calls(created_at DESC);
    END IF;
    
    -- voice_agent_leads indexes
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_voice_agent_leads_business_id') THEN
        CREATE INDEX idx_voice_agent_leads_business_id ON voice_agent_leads(business_id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_voice_agent_leads_agent_id') THEN
        CREATE INDEX idx_voice_agent_leads_agent_id ON voice_agent_leads(agent_id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_voice_agent_leads_status') THEN
        CREATE INDEX idx_voice_agent_leads_status ON voice_agent_leads(business_id, status);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_voice_agent_leads_follow_up') THEN
        CREATE INDEX idx_voice_agent_leads_follow_up ON voice_agent_leads(business_id, follow_up_at) WHERE follow_up_at IS NOT NULL AND follow_up_completed = false;
    END IF;
END $$;

-- Enable RLS
ALTER TABLE voice_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_agent_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_agent_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_agent_configurations ENABLE ROW LEVEL SECURITY;

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_voice_agent_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers (drop and recreate to ensure they're correct)
DROP TRIGGER IF EXISTS voice_agents_updated_at ON voice_agents;
CREATE TRIGGER voice_agents_updated_at
    BEFORE UPDATE ON voice_agents
    FOR EACH ROW
    EXECUTE FUNCTION update_voice_agent_updated_at();

DROP TRIGGER IF EXISTS voice_agent_calls_updated_at ON voice_agent_calls;
CREATE TRIGGER voice_agent_calls_updated_at
    BEFORE UPDATE ON voice_agent_calls
    FOR EACH ROW
    EXECUTE FUNCTION update_voice_agent_updated_at();

DROP TRIGGER IF EXISTS voice_agent_leads_updated_at ON voice_agent_leads;
CREATE TRIGGER voice_agent_leads_updated_at
    BEFORE UPDATE ON voice_agent_leads
    FOR EACH ROW
    EXECUTE FUNCTION update_voice_agent_updated_at();

DROP TRIGGER IF EXISTS voice_agent_configurations_updated_at ON voice_agent_configurations;
CREATE TRIGGER voice_agent_configurations_updated_at
    BEFORE UPDATE ON voice_agent_configurations
    FOR EACH ROW
    EXECUTE FUNCTION update_voice_agent_updated_at();

-- Comments
COMMENT ON TABLE voice_agents IS 'AI voice agent configurations for businesses';
COMMENT ON TABLE voice_agent_calls IS 'Call records and analytics for voice agents';
COMMENT ON TABLE voice_agent_leads IS 'Leads captured from voice agent calls';
COMMENT ON TABLE voice_agent_configurations IS 'Business-level voice agent settings and credentials';


