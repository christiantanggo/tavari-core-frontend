-- RLS Policies for Custom Voice Agent Tables
-- These policies allow users to access custom voice agents for their business

-- Drop existing policies if they exist (idempotent)
DROP POLICY IF EXISTS "Users can view custom voice agents for their businesses" ON custom_voice_agents;
DROP POLICY IF EXISTS "Owners/admins can create custom voice agents" ON custom_voice_agents;
DROP POLICY IF EXISTS "Owners/admins can update custom voice agents" ON custom_voice_agents;
DROP POLICY IF EXISTS "Owners/admins can delete custom voice agents" ON custom_voice_agents;

-- Policy: Users can view custom voice agents for their business
CREATE POLICY "Users can view custom voice agents for their businesses"
ON custom_voice_agents
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.business_id = custom_voice_agents.business_id
    AND ur.active = true
  )
);

-- Policy: Owners/admins can create custom voice agents
CREATE POLICY "Owners/admins can create custom voice agents"
ON custom_voice_agents
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.business_id = custom_voice_agents.business_id
    AND ur.active = true
    AND ur.role IN ('owner', 'manager', 'admin')
  )
);

-- Policy: Owners/admins can update custom voice agents
CREATE POLICY "Owners/admins can update custom voice agents"
ON custom_voice_agents
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.business_id = custom_voice_agents.business_id
    AND ur.active = true
    AND ur.role IN ('owner', 'manager', 'admin')
  )
);

-- Policy: Owners/admins can delete custom voice agents
CREATE POLICY "Owners/admins can delete custom voice agents"
ON custom_voice_agents
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.business_id = custom_voice_agents.business_id
    AND ur.active = true
    AND ur.role IN ('owner', 'manager', 'admin')
  )
);

-- Similar policies for other custom voice agent tables
-- Calls table
DROP POLICY IF EXISTS "Users can view calls for their businesses" ON custom_voice_agent_calls;
CREATE POLICY "Users can view calls for their businesses"
ON custom_voice_agent_calls
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.business_id = custom_voice_agent_calls.business_id
    AND ur.active = true
  )
  OR
  -- Allow system/service role to view (for webhooks)
  auth.role() = 'service_role'
);

-- Leads table
DROP POLICY IF EXISTS "Users can view leads for their businesses" ON custom_voice_agent_leads;
CREATE POLICY "Users can view leads for their businesses"
ON custom_voice_agent_leads
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.business_id = custom_voice_agent_leads.business_id
    AND ur.active = true
  )
);

-- Bookings table
DROP POLICY IF EXISTS "Users can view bookings for their businesses" ON custom_voice_agent_bookings;
CREATE POLICY "Users can view bookings for their businesses"
ON custom_voice_agent_bookings
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.business_id = custom_voice_agent_bookings.business_id
    AND ur.active = true
  )
);

-- Messages table
DROP POLICY IF EXISTS "Users can view messages for their businesses" ON custom_voice_agent_messages;
CREATE POLICY "Users can view messages for their businesses"
ON custom_voice_agent_messages
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.business_id = custom_voice_agent_messages.business_id
    AND ur.active = true
  )
);

-- Configurations table
DROP POLICY IF EXISTS "Users can view configurations for their businesses" ON custom_voice_agent_configurations;
CREATE POLICY "Users can view configurations for their businesses"
ON custom_voice_agent_configurations
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.business_id = custom_voice_agent_configurations.business_id
    AND ur.active = true
    AND ur.role IN ('owner', 'manager', 'admin')
  )
);

DROP POLICY IF EXISTS "Owners/admins can manage configurations for their businesses" ON custom_voice_agent_configurations;
CREATE POLICY "Owners/admins can manage configurations for their businesses"
ON custom_voice_agent_configurations
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.business_id = custom_voice_agent_configurations.business_id
    AND ur.active = true
    AND ur.role IN ('owner', 'manager', 'admin')
  )
);

-- Logs table
DROP POLICY IF EXISTS "Users can view logs for their businesses" ON custom_voice_agent_logs;
CREATE POLICY "Users can view logs for their businesses"
ON custom_voice_agent_logs
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.business_id = custom_voice_agent_logs.business_id
    AND ur.active = true
  )
);

