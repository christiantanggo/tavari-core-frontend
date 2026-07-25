-- Add calendar integration fields to voice_agents table
-- Supports Google Calendar and Microsoft Outlook/Office 365

ALTER TABLE voice_agents 
    ADD COLUMN IF NOT EXISTS calendar_enabled boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS calendar_type text CHECK (calendar_type IN ('google', 'outlook', 'ical')),
    ADD COLUMN IF NOT EXISTS calendar_email text,
    ADD COLUMN IF NOT EXISTS calendar_calendar_id text, -- Specific calendar ID to use (optional)
    ADD COLUMN IF NOT EXISTS calendar_credentials jsonb, -- Encrypted credentials/refresh tokens
    ADD COLUMN IF NOT EXISTS calendar_sync_on_booking boolean DEFAULT true, -- Auto-sync when booking created
    ADD COLUMN IF NOT EXISTS calendar_sync_on_update boolean DEFAULT true, -- Auto-sync when booking updated
    ADD COLUMN IF NOT EXISTS calendar_sync_on_cancel boolean DEFAULT true; -- Auto-sync when booking cancelled

COMMENT ON COLUMN voice_agents.calendar_enabled IS 'Whether calendar integration is enabled for this agent';
COMMENT ON COLUMN voice_agents.calendar_type IS 'Calendar service type: google, outlook, or ical';
COMMENT ON COLUMN voice_agents.calendar_email IS 'Email address associated with the calendar';
COMMENT ON COLUMN voice_agents.calendar_calendar_id IS 'Specific calendar ID to use (for Google: calendar ID, for Outlook: calendar name)';
COMMENT ON COLUMN voice_agents.calendar_credentials IS 'Encrypted credentials (refresh tokens, API keys, etc.)';
COMMENT ON COLUMN voice_agents.calendar_sync_on_booking IS 'Automatically create calendar event when booking is created';
COMMENT ON COLUMN voice_agents.calendar_sync_on_update IS 'Automatically update calendar event when booking is updated';
COMMENT ON COLUMN voice_agents.calendar_sync_on_cancel IS 'Automatically delete/update calendar event when booking is cancelled';

-- Add calendar event tracking to voice_agent_bookings table
ALTER TABLE voice_agent_bookings
    ADD COLUMN IF NOT EXISTS calendar_event_id text, -- External calendar event ID
    ADD COLUMN IF NOT EXISTS calendar_event_url text, -- Link to calendar event
    ADD COLUMN IF NOT EXISTS calendar_synced_at timestamptz, -- When calendar event was last synced
    ADD COLUMN IF NOT EXISTS calendar_sync_error text; -- Error message if sync failed

COMMENT ON COLUMN voice_agent_bookings.calendar_event_id IS 'External calendar event ID (Google Calendar event ID, Outlook event ID, etc.)';
COMMENT ON COLUMN voice_agent_bookings.calendar_event_url IS 'URL to view/edit the calendar event';
COMMENT ON COLUMN voice_agent_bookings.calendar_synced_at IS 'Timestamp when calendar event was last successfully synced';
COMMENT ON COLUMN voice_agent_bookings.calendar_sync_error IS 'Error message if calendar sync failed';

-- Create index for calendar event lookup
CREATE INDEX IF NOT EXISTS idx_voice_agent_bookings_calendar_event_id 
    ON voice_agent_bookings(calendar_event_id) 
    WHERE calendar_event_id IS NOT NULL;

-- Create calendar sync logs table for debugging
CREATE TABLE IF NOT EXISTS voice_agent_calendar_sync_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id uuid REFERENCES voice_agent_bookings(id) ON DELETE CASCADE,
    agent_id uuid REFERENCES voice_agents(id) ON DELETE CASCADE,
    business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
    sync_action text NOT NULL CHECK (sync_action IN ('create', 'update', 'delete', 'refresh')),
    calendar_type text NOT NULL,
    calendar_event_id text,
    status text NOT NULL CHECK (status IN ('success', 'error', 'pending')),
    error_message text,
    sync_data jsonb, -- Request/response data for debugging
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_sync_logs_booking_id ON voice_agent_calendar_sync_logs(booking_id);
CREATE INDEX IF NOT EXISTS idx_calendar_sync_logs_agent_id ON voice_agent_calendar_sync_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_calendar_sync_logs_created_at ON voice_agent_calendar_sync_logs(created_at DESC);

COMMENT ON TABLE voice_agent_calendar_sync_logs IS 'Logs of all calendar sync operations for debugging and auditing';

