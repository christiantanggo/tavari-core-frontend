-- Voice Agent Module - RLS Policies
-- Row Level Security policies for voice agent tables

-- voice_agents policies
CREATE POLICY "voice_agents_select"
    ON voice_agents
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agents.business_id
            AND ur.active = true
        )
    );

CREATE POLICY "voice_agents_insert"
    ON voice_agents
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agents.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

CREATE POLICY "voice_agents_update"
    ON voice_agents
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agents.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

CREATE POLICY "voice_agents_delete"
    ON voice_agents
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agents.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

-- voice_agent_calls policies
CREATE POLICY "voice_agent_calls_select"
    ON voice_agent_calls
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_calls.business_id
            AND ur.active = true
        )
    );

CREATE POLICY "voice_agent_calls_insert"
    ON voice_agent_calls
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_calls.business_id
            AND ur.active = true
        )
        OR
        -- Allow system/service role to insert (for webhooks)
        auth.role() = 'service_role'
    );

CREATE POLICY "voice_agent_calls_update"
    ON voice_agent_calls
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_calls.business_id
            AND ur.active = true
        )
        OR
        auth.role() = 'service_role'
    );

-- voice_agent_leads policies
CREATE POLICY "voice_agent_leads_select"
    ON voice_agent_leads
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_leads.business_id
            AND ur.active = true
        )
    );

CREATE POLICY "voice_agent_leads_insert"
    ON voice_agent_leads
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_leads.business_id
            AND ur.active = true
        )
        OR
        auth.role() = 'service_role'
    );

CREATE POLICY "voice_agent_leads_update"
    ON voice_agent_leads
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_leads.business_id
            AND ur.active = true
        )
    );

CREATE POLICY "voice_agent_leads_delete"
    ON voice_agent_leads
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_leads.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

-- voice_agent_configurations policies
CREATE POLICY "voice_agent_configurations_select"
    ON voice_agent_configurations
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_configurations.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

CREATE POLICY "voice_agent_configurations_insert"
    ON voice_agent_configurations
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_configurations.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

CREATE POLICY "voice_agent_configurations_update"
    ON voice_agent_configurations
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_configurations.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );


