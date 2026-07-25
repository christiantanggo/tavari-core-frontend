-- Custom AI Voice Agent Module - Database Schema
-- This is a NEW module that uses Telnyx + OpenAI Realtime directly (no VAPI)
-- All tables use custom_voice_agent_ prefix to distinguish from existing voice_agent tables

-- Table: custom_voice_agents
-- Stores AI voice agent configurations per business
CREATE TABLE IF NOT EXISTS custom_voice_agents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    industry_type text, -- 'fec', 'restaurant', 'medical', 'salon', 'contractor', 'custom'
    
    -- Telnyx Configuration (replaces VAPI)
    telnyx_phone_number_id text, -- Telnyx phone number ID
    telnyx_connection_id text,
    
    -- Phone Configuration
    phone_number text, -- Telnyx phone number
    forward_to_phone text, -- Phone number to forward calls to (conditional forwarding)
    ring_count integer DEFAULT 3, -- Number of rings before AI picks up
    
    -- Agent Configuration
    system_prompt text NOT NULL,
    first_message text,
    voice_provider text DEFAULT 'openai', -- 'openai' for Realtime API
    voice_id text DEFAULT 'alloy', -- OpenAI voice ID
    model_provider text DEFAULT 'openai',
    model_name text DEFAULT 'gpt-4o-realtime-preview-2024-10-01', -- OpenAI Realtime model
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
    
    -- OpenAI Realtime Session Configuration
    realtime_session_id text, -- Active OpenAI Realtime session ID
    realtime_session_status text, -- 'active', 'ended', 'error'
    
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
        WHERE conname = 'custom_voice_agents_business_id_fkey'
    ) THEN
        ALTER TABLE custom_voice_agents
        ADD CONSTRAINT custom_voice_agents_business_id_fkey 
            FOREIGN KEY (business_id) 
            REFERENCES businesses(id) 
            ON DELETE CASCADE;
    END IF;
END $$;

-- Table: custom_voice_agent_calls
-- Stores call records and analytics
CREATE TABLE IF NOT EXISTS custom_voice_agent_calls (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    
    -- Call Information
    telnyx_call_id text UNIQUE, -- Telnyx call ID
    openai_session_id text, -- OpenAI Realtime session ID
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
    metadata jsonb, -- Additional call data from Telnyx/OpenAI
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Add foreign keys for calls table
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_calls_business_id_fkey'
    ) THEN
        ALTER TABLE custom_voice_agent_calls
        ADD CONSTRAINT custom_voice_agent_calls_business_id_fkey 
            FOREIGN KEY (business_id) 
            REFERENCES businesses(id) 
            ON DELETE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_calls_agent_id_fkey'
    ) THEN
        ALTER TABLE custom_voice_agent_calls
        ADD CONSTRAINT custom_voice_agent_calls_agent_id_fkey 
            FOREIGN KEY (agent_id) 
            REFERENCES custom_voice_agents(id) 
            ON DELETE CASCADE;
    END IF;
END $$;

-- Table: custom_voice_agent_leads
-- Stores leads captured from calls
CREATE TABLE IF NOT EXISTS custom_voice_agent_leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    call_id uuid,
    
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

-- Add foreign keys for leads table
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_leads_business_id_fkey'
    ) THEN
        ALTER TABLE custom_voice_agent_leads
        ADD CONSTRAINT custom_voice_agent_leads_business_id_fkey 
            FOREIGN KEY (business_id) 
            REFERENCES businesses(id) 
            ON DELETE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_leads_agent_id_fkey'
    ) THEN
        ALTER TABLE custom_voice_agent_leads
        ADD CONSTRAINT custom_voice_agent_leads_agent_id_fkey 
            FOREIGN KEY (agent_id) 
            REFERENCES custom_voice_agents(id) 
            ON DELETE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_leads_call_id_fkey'
    ) THEN
        ALTER TABLE custom_voice_agent_leads
        ADD CONSTRAINT custom_voice_agent_leads_call_id_fkey 
            FOREIGN KEY (call_id) 
            REFERENCES custom_voice_agent_calls(id) 
            ON DELETE SET NULL;
    END IF;
END $$;

-- Table: custom_voice_agent_bookings
-- Stores bookings/reservations captured from calls
CREATE TABLE IF NOT EXISTS custom_voice_agent_bookings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    call_id uuid,
    
    -- Booking Information
    customer_name text NOT NULL,
    customer_phone text NOT NULL,
    customer_email text,
    booking_type text DEFAULT 'appointment', -- 'appointment', 'reservation', 'party', etc.
    service_type text,
    booking_date date NOT NULL,
    booking_time time NOT NULL,
    party_size integer DEFAULT 1,
    duration_minutes integer DEFAULT 30,
    
    -- Status
    status text DEFAULT 'confirmed', -- 'pending', 'confirmed', 'cancelled', 'completed'
    notes text,
    
    -- Timestamps
    confirmed_at timestamptz,
    cancelled_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Add foreign keys for bookings table
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_bookings_business_id_fkey'
    ) THEN
        ALTER TABLE custom_voice_agent_bookings
        ADD CONSTRAINT custom_voice_agent_bookings_business_id_fkey 
            FOREIGN KEY (business_id) 
            REFERENCES businesses(id) 
            ON DELETE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_bookings_agent_id_fkey'
    ) THEN
        ALTER TABLE custom_voice_agent_bookings
        ADD CONSTRAINT custom_voice_agent_bookings_agent_id_fkey 
            FOREIGN KEY (agent_id) 
            REFERENCES custom_voice_agents(id) 
            ON DELETE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_bookings_call_id_fkey'
    ) THEN
        ALTER TABLE custom_voice_agent_bookings
        ADD CONSTRAINT custom_voice_agent_bookings_call_id_fkey 
            FOREIGN KEY (call_id) 
            REFERENCES custom_voice_agent_calls(id) 
            ON DELETE SET NULL;
    END IF;
END $$;

-- Table: custom_voice_agent_messages
-- Stores messages/callback requests from calls
CREATE TABLE IF NOT EXISTS custom_voice_agent_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    call_id uuid,
    
    -- Message Information
    customer_name text,
    customer_phone text NOT NULL,
    customer_email text,
    message text NOT NULL,
    priority text DEFAULT 'normal', -- 'low', 'normal', 'high', 'urgent'
    
    -- Status
    status text DEFAULT 'new', -- 'new', 'read', 'contacted', 'resolved'
    assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    
    -- Timestamps
    read_at timestamptz,
    contacted_at timestamptz,
    resolved_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Add foreign keys for messages table
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_messages_business_id_fkey'
    ) THEN
        ALTER TABLE custom_voice_agent_messages
        ADD CONSTRAINT custom_voice_agent_messages_business_id_fkey 
            FOREIGN KEY (business_id) 
            REFERENCES businesses(id) 
            ON DELETE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_messages_agent_id_fkey'
    ) THEN
        ALTER TABLE custom_voice_agent_messages
        ADD CONSTRAINT custom_voice_agent_messages_agent_id_fkey 
            FOREIGN KEY (agent_id) 
            REFERENCES custom_voice_agents(id) 
            ON DELETE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_messages_call_id_fkey'
    ) THEN
        ALTER TABLE custom_voice_agent_messages
        ADD CONSTRAINT custom_voice_agent_messages_call_id_fkey 
            FOREIGN KEY (call_id) 
            REFERENCES custom_voice_agent_calls(id) 
            ON DELETE SET NULL;
    END IF;
END $$;

-- Table: custom_voice_agent_configurations
-- Stores business-specific voice agent settings
CREATE TABLE IF NOT EXISTS custom_voice_agent_configurations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    
    -- API Credentials (encrypted)
    telnyx_api_key_encrypted text, -- Encrypted Telnyx API key
    openai_api_key_encrypted text, -- Encrypted OpenAI API key
    
    -- Webhook Configuration
    webhook_url text, -- Server URL for webhooks (Tavari Voice Server)
    
    -- Default Settings
    default_voice_provider text DEFAULT 'openai',
    default_voice_id text DEFAULT 'alloy',
    default_model text DEFAULT 'gpt-4o-realtime-preview-2024-10-01',
    
    -- Notification Settings
    notify_on_new_lead boolean DEFAULT true,
    notify_on_call_failed boolean DEFAULT false,
    notify_on_booking boolean DEFAULT true,
    notification_email text,
    notification_sms text,
    
    -- Metadata
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Add constraints for configurations table
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_configurations_business_id_fkey'
    ) THEN
        ALTER TABLE custom_voice_agent_configurations
        ADD CONSTRAINT custom_voice_agent_configurations_business_id_fkey 
            FOREIGN KEY (business_id) 
            REFERENCES businesses(id) 
            ON DELETE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_configurations_business_id_unique'
    ) THEN
        ALTER TABLE custom_voice_agent_configurations
        ADD CONSTRAINT custom_voice_agent_configurations_business_id_unique 
            UNIQUE (business_id);
    END IF;
END $$;

-- Table: custom_voice_agent_logs
-- Stores detailed logs for debugging and monitoring
CREATE TABLE IF NOT EXISTS custom_voice_agent_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    agent_id uuid,
    call_id uuid,
    
    -- Log Information
    log_level text NOT NULL, -- 'info', 'warning', 'error', 'debug'
    log_type text, -- 'call_start', 'call_end', 'function_call', 'error', etc.
    message text NOT NULL,
    details jsonb, -- Additional log data
    
    -- Metadata
    created_at timestamptz DEFAULT now()
);

-- Add foreign keys for logs table
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_logs_business_id_fkey'
    ) THEN
        ALTER TABLE custom_voice_agent_logs
        ADD CONSTRAINT custom_voice_agent_logs_business_id_fkey 
            FOREIGN KEY (business_id) 
            REFERENCES businesses(id) 
            ON DELETE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_logs_agent_id_fkey'
    ) THEN
        ALTER TABLE custom_voice_agent_logs
        ADD CONSTRAINT custom_voice_agent_logs_agent_id_fkey 
            FOREIGN KEY (agent_id) 
            REFERENCES custom_voice_agents(id) 
            ON DELETE SET NULL;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_logs_call_id_fkey'
    ) THEN
        ALTER TABLE custom_voice_agent_logs
        ADD CONSTRAINT custom_voice_agent_logs_call_id_fkey 
            FOREIGN KEY (call_id) 
            REFERENCES custom_voice_agent_calls(id) 
            ON DELETE SET NULL;
    END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_custom_voice_agents_business_id 
    ON custom_voice_agents(business_id);

CREATE INDEX IF NOT EXISTS idx_custom_voice_agents_active 
    ON custom_voice_agents(business_id, is_active) 
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_calls_business_id 
    ON custom_voice_agent_calls(business_id);

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_calls_agent_id 
    ON custom_voice_agent_calls(agent_id);

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_calls_telnyx_call_id 
    ON custom_voice_agent_calls(telnyx_call_id) 
    WHERE telnyx_call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_calls_created_at 
    ON custom_voice_agent_calls(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_leads_business_id 
    ON custom_voice_agent_leads(business_id);

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_leads_agent_id 
    ON custom_voice_agent_leads(agent_id);

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_leads_status 
    ON custom_voice_agent_leads(business_id, status);

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_bookings_business_id 
    ON custom_voice_agent_bookings(business_id);

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_bookings_agent_id 
    ON custom_voice_agent_bookings(agent_id);

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_bookings_date 
    ON custom_voice_agent_bookings(booking_date, booking_time);

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_messages_business_id 
    ON custom_voice_agent_messages(business_id);

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_messages_status 
    ON custom_voice_agent_messages(business_id, status);

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_logs_business_id 
    ON custom_voice_agent_logs(business_id);

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_logs_created_at 
    ON custom_voice_agent_logs(created_at DESC);

-- Enable RLS
ALTER TABLE custom_voice_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_voice_agent_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_voice_agent_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_voice_agent_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_voice_agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_voice_agent_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_voice_agent_logs ENABLE ROW LEVEL SECURITY;

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_custom_voice_agent_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers (drop if exists first)
DROP TRIGGER IF EXISTS custom_voice_agents_updated_at ON custom_voice_agents;
CREATE TRIGGER custom_voice_agents_updated_at
    BEFORE UPDATE ON custom_voice_agents
    FOR EACH ROW
    EXECUTE FUNCTION update_custom_voice_agent_updated_at();

DROP TRIGGER IF EXISTS custom_voice_agent_calls_updated_at ON custom_voice_agent_calls;
CREATE TRIGGER custom_voice_agent_calls_updated_at
    BEFORE UPDATE ON custom_voice_agent_calls
    FOR EACH ROW
    EXECUTE FUNCTION update_custom_voice_agent_updated_at();

DROP TRIGGER IF EXISTS custom_voice_agent_leads_updated_at ON custom_voice_agent_leads;
CREATE TRIGGER custom_voice_agent_leads_updated_at
    BEFORE UPDATE ON custom_voice_agent_leads
    FOR EACH ROW
    EXECUTE FUNCTION update_custom_voice_agent_updated_at();

DROP TRIGGER IF EXISTS custom_voice_agent_bookings_updated_at ON custom_voice_agent_bookings;
CREATE TRIGGER custom_voice_agent_bookings_updated_at
    BEFORE UPDATE ON custom_voice_agent_bookings
    FOR EACH ROW
    EXECUTE FUNCTION update_custom_voice_agent_updated_at();

DROP TRIGGER IF EXISTS custom_voice_agent_messages_updated_at ON custom_voice_agent_messages;
CREATE TRIGGER custom_voice_agent_messages_updated_at
    BEFORE UPDATE ON custom_voice_agent_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_custom_voice_agent_updated_at();

DROP TRIGGER IF EXISTS custom_voice_agent_configurations_updated_at ON custom_voice_agent_configurations;
CREATE TRIGGER custom_voice_agent_configurations_updated_at
    BEFORE UPDATE ON custom_voice_agent_configurations
    FOR EACH ROW
    EXECUTE FUNCTION update_custom_voice_agent_updated_at();

-- Comments
COMMENT ON TABLE custom_voice_agents IS 'Custom AI voice agent configurations using Telnyx + OpenAI Realtime (no VAPI)';
COMMENT ON TABLE custom_voice_agent_calls IS 'Call records and analytics for custom voice agents';
COMMENT ON TABLE custom_voice_agent_leads IS 'Leads captured from custom voice agent calls';
COMMENT ON TABLE custom_voice_agent_bookings IS 'Bookings/reservations captured from custom voice agent calls';
COMMENT ON TABLE custom_voice_agent_messages IS 'Messages/callback requests from custom voice agent calls';
COMMENT ON TABLE custom_voice_agent_configurations IS 'Business-level custom voice agent settings and credentials';
COMMENT ON TABLE custom_voice_agent_logs IS 'Detailed logs for debugging and monitoring custom voice agents';

