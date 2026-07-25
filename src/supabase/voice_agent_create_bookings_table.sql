-- Voice Agent Lite Booking Module - Database Schema
-- Simple booking/reservation system for voice agents
-- Supports: Hair salons, contractors, callbacks, restaurant reservations

-- Table: voice_agent_bookings
-- Stores appointments, reservations, and callback schedules
CREATE TABLE IF NOT EXISTS voice_agent_bookings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    agent_id uuid NOT NULL REFERENCES voice_agents(id) ON DELETE CASCADE,
    call_id uuid REFERENCES voice_agent_calls(id) ON DELETE SET NULL,
    
    -- Customer Information
    customer_name text NOT NULL,
    customer_phone text NOT NULL,
    customer_email text,
    
    -- Booking Details
    booking_type text NOT NULL CHECK (booking_type IN ('appointment', 'reservation', 'callback')),
    service_type text, -- e.g., 'haircut', 'consultation', 'dinner reservation', 'lunch', etc.
    booking_date date NOT NULL,
    booking_time time NOT NULL,
    party_size integer DEFAULT 1, -- For restaurant reservations
    duration_minutes integer DEFAULT 30, -- Duration in minutes
    
    -- Status & Notes
    status text DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
    notes text, -- Special requests, dietary restrictions, etc.
    
    -- Confirmation
    confirmation_code text UNIQUE, -- Auto-generated confirmation code
    confirmed_at timestamptz,
    cancelled_at timestamptz,
    cancellation_reason text,
    
    -- Metadata
    source_data jsonb, -- Raw data from AI function call
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    
    CONSTRAINT voice_agent_bookings_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT voice_agent_bookings_agent_id_fkey 
        FOREIGN KEY (agent_id) 
        REFERENCES voice_agents(id) 
        ON DELETE CASCADE
);

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
CREATE OR REPLACE FUNCTION update_voice_agent_bookings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_voice_agent_bookings_updated_at 
    BEFORE UPDATE ON voice_agent_bookings 
    FOR EACH ROW 
    EXECUTE FUNCTION update_voice_agent_bookings_updated_at();

-- Function to generate confirmation code
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

CREATE TRIGGER set_booking_confirmation_code_trigger
    BEFORE INSERT ON voice_agent_bookings
    FOR EACH ROW
    EXECUTE FUNCTION set_booking_confirmation_code();

