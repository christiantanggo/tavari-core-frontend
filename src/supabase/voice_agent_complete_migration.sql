-- ============================================================================
-- Voice Agent Complete Migration
-- Includes: Bookings Module + Call Forwarding Configuration
-- ============================================================================

-- ============================================================================
-- PART 1: BOOKINGS MODULE
-- ============================================================================

-- Table: voice_agent_bookings
-- Stores appointments, reservations, and callback schedules
CREATE TABLE IF NOT EXISTS voice_agent_bookings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    call_id uuid,
    
    -- Customer Information
    customer_name text NOT NULL,
    customer_phone text NOT NULL,
    customer_email text,
    
    -- Booking Details
    booking_type text NOT NULL,
    service_type text, -- e.g., 'haircut', 'consultation', 'dinner reservation', 'lunch', etc.
    booking_date date NOT NULL,
    booking_time time NOT NULL,
    party_size integer DEFAULT 1, -- For restaurant reservations
    duration_minutes integer DEFAULT 30, -- Duration in minutes
    
    -- Status & Notes
    status text DEFAULT 'confirmed',
    notes text, -- Special requests, dietary restrictions, etc.
    
    -- Confirmation
    confirmation_code text,
    confirmed_at timestamptz,
    cancelled_at timestamptz,
    cancellation_reason text,
    
    -- Metadata
    source_data jsonb, -- Raw data from AI function call
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Add foreign key constraints (idempotent - only add if they don't exist)
DO $$ 
BEGIN
    -- Add business_id foreign key
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'voice_agent_bookings_business_id_fkey'
    ) THEN
        ALTER TABLE voice_agent_bookings 
            ADD CONSTRAINT voice_agent_bookings_business_id_fkey 
                FOREIGN KEY (business_id) 
                REFERENCES businesses(id) 
                ON DELETE CASCADE;
    END IF;
    
    -- Add agent_id foreign key
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'voice_agent_bookings_agent_id_fkey'
    ) THEN
        ALTER TABLE voice_agent_bookings 
            ADD CONSTRAINT voice_agent_bookings_agent_id_fkey 
                FOREIGN KEY (agent_id) 
                REFERENCES voice_agents(id) 
                ON DELETE CASCADE;
    END IF;
    
    -- Add call_id foreign key (only if voice_agent_calls table exists)
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'voice_agent_calls'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'voice_agent_bookings_call_id_fkey'
    ) THEN
        ALTER TABLE voice_agent_bookings 
            ADD CONSTRAINT voice_agent_bookings_call_id_fkey 
                FOREIGN KEY (call_id) 
                REFERENCES voice_agent_calls(id) 
                ON DELETE SET NULL;
    END IF;
    
    -- Add booking_type check constraint
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'voice_agent_bookings_booking_type_check'
    ) THEN
        ALTER TABLE voice_agent_bookings 
            ADD CONSTRAINT voice_agent_bookings_booking_type_check 
                CHECK (booking_type IN ('appointment', 'reservation', 'callback'));
    END IF;
    
    -- Add status check constraint
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'voice_agent_bookings_status_check'
    ) THEN
        ALTER TABLE voice_agent_bookings 
            ADD CONSTRAINT voice_agent_bookings_status_check 
                CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show'));
    END IF;
    
    -- Add unique constraint on confirmation_code
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'voice_agent_bookings_confirmation_code_key'
    ) THEN
        ALTER TABLE voice_agent_bookings 
            ADD CONSTRAINT voice_agent_bookings_confirmation_code_key 
                UNIQUE (confirmation_code);
    END IF;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_voice_agent_bookings_business_id 
    ON voice_agent_bookings(business_id);
    
CREATE INDEX IF NOT EXISTS idx_voice_agent_bookings_agent_id 
    ON voice_agent_bookings(agent_id);
    
CREATE INDEX IF NOT EXISTS idx_voice_agent_bookings_date_time 
    ON voice_agent_bookings(booking_date, booking_time);
    
CREATE INDEX IF NOT EXISTS idx_voice_agent_bookings_status 
    ON voice_agent_bookings(status, booking_date);
    
CREATE INDEX IF NOT EXISTS idx_voice_agent_bookings_confirmation_code 
    ON voice_agent_bookings(confirmation_code) 
    WHERE confirmation_code IS NOT NULL;

-- Add booking_types column to voice_agents table for configuration
ALTER TABLE voice_agents 
    ADD COLUMN IF NOT EXISTS booking_types jsonb DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS booking_slot_duration integer DEFAULT 30, -- Default 30 minutes
    ADD COLUMN IF NOT EXISTS booking_buffer_minutes integer DEFAULT 0, -- Buffer between bookings
    ADD COLUMN IF NOT EXISTS max_party_size integer DEFAULT 10, -- Max party size for reservations
    ADD COLUMN IF NOT EXISTS booking_advance_days integer DEFAULT 90; -- How far ahead can bookings be made

COMMENT ON COLUMN voice_agents.booking_types IS 'Array of booking types: [{"type": "haircut", "duration": 30}, {"type": "consultation", "duration": 60}]';
COMMENT ON COLUMN voice_agents.booking_slot_duration IS 'Default time slot duration in minutes (15, 30, 60)';
COMMENT ON COLUMN voice_agents.booking_buffer_minutes IS 'Buffer time between bookings in minutes';
COMMENT ON COLUMN voice_agents.max_party_size IS 'Maximum party size for reservations';
COMMENT ON COLUMN voice_agents.booking_advance_days IS 'How many days in advance customers can book';

-- Enable RLS
ALTER TABLE voice_agent_bookings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for voice_agent_bookings

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can view bookings for their businesses" ON voice_agent_bookings;
DROP POLICY IF EXISTS "Users can create bookings for their businesses" ON voice_agent_bookings;
DROP POLICY IF EXISTS "Users can update bookings for their businesses" ON voice_agent_bookings;
DROP POLICY IF EXISTS "Users can delete bookings for their businesses" ON voice_agent_bookings;

-- Users can view bookings for their businesses
CREATE POLICY "Users can view bookings for their businesses"
ON voice_agent_bookings FOR SELECT
USING (
    business_id IN (
        SELECT business_id FROM user_roles 
        WHERE user_id = auth.uid() 
        AND role IN ('owner', 'manager', 'admin', 'employee')
    )
);

-- System can insert bookings (via webhook with service role)
-- Note: Webhook uses service role, so this is mainly for UI inserts
CREATE POLICY "Users can create bookings for their businesses"
ON voice_agent_bookings FOR INSERT
WITH CHECK (
    business_id IN (
        SELECT business_id FROM user_roles 
        WHERE user_id = auth.uid() 
        AND role IN ('owner', 'manager', 'admin')
    )
);

-- Users can update bookings for their businesses
CREATE POLICY "Users can update bookings for their businesses"
ON voice_agent_bookings FOR UPDATE
USING (
    business_id IN (
        SELECT business_id FROM user_roles 
        WHERE user_id = auth.uid() 
        AND role IN ('owner', 'manager', 'admin')
    )
)
WITH CHECK (
    business_id IN (
        SELECT business_id FROM user_roles 
        WHERE user_id = auth.uid() 
        AND role IN ('owner', 'manager', 'admin')
    )
);

-- Users can delete bookings for their businesses
CREATE POLICY "Users can delete bookings for their businesses"
ON voice_agent_bookings FOR DELETE
USING (
    business_id IN (
        SELECT business_id FROM user_roles 
        WHERE user_id = auth.uid() 
        AND role IN ('owner', 'manager', 'admin')
    )
);

-- Add trigger to update updated_at
DROP FUNCTION IF EXISTS update_voice_agent_bookings_updated_at() CASCADE;
CREATE OR REPLACE FUNCTION update_voice_agent_bookings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_voice_agent_bookings_updated_at ON voice_agent_bookings;
CREATE TRIGGER update_voice_agent_bookings_updated_at 
    BEFORE UPDATE ON voice_agent_bookings 
    FOR EACH ROW 
    EXECUTE FUNCTION update_voice_agent_bookings_updated_at();

-- Function to generate confirmation code
DROP FUNCTION IF EXISTS generate_booking_confirmation_code() CASCADE;
CREATE OR REPLACE FUNCTION generate_booking_confirmation_code()
RETURNS text AS $$
DECLARE
    chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- Excluding confusing chars
    result text := '';
    i integer;
BEGIN
    FOR i IN 1..8 LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate confirmation code
DROP FUNCTION IF EXISTS set_booking_confirmation_code() CASCADE;
CREATE OR REPLACE FUNCTION set_booking_confirmation_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.confirmation_code IS NULL THEN
        LOOP
            NEW.confirmation_code := generate_booking_confirmation_code();
            EXIT WHEN NOT EXISTS (
                SELECT 1 FROM voice_agent_bookings 
                WHERE confirmation_code = NEW.confirmation_code
            );
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_booking_confirmation_code_trigger ON voice_agent_bookings;
CREATE TRIGGER set_booking_confirmation_code_trigger
    BEFORE INSERT ON voice_agent_bookings
    FOR EACH ROW
    EXECUTE FUNCTION set_booking_confirmation_code();

-- ============================================================================
-- PART 2: CALL FORWARDING CONFIGURATION
-- ============================================================================

-- Add forwarding configuration to voice_agents table
ALTER TABLE voice_agents 
    ADD COLUMN IF NOT EXISTS forward_to_phone text, -- Phone number to forward calls to
    ADD COLUMN IF NOT EXISTS forward_ring_count integer DEFAULT 3, -- Number of rings before forwarding
    ADD COLUMN IF NOT EXISTS forward_enabled boolean DEFAULT false; -- Whether forwarding is enabled

COMMENT ON COLUMN voice_agents.forward_to_phone IS 'Phone number to forward calls to (user-owned number)';
COMMENT ON COLUMN voice_agents.forward_ring_count IS 'Number of rings before forwarding to user phone (1-6)';
COMMENT ON COLUMN voice_agents.forward_enabled IS 'Whether call forwarding is enabled';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

