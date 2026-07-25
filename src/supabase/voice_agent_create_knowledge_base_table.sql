-- ============================================
-- Create Knowledge Base Configuration Table
-- ============================================
-- This table stores business-scoped knowledge base configuration
-- shared across all agents (voice, future SMS, future email)

-- Create the knowledge base table
CREATE TABLE IF NOT EXISTS voice_agent_knowledge_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    
    -- Message Configuration
    first_message TEXT, -- Opening greeting message for AI agents
    last_message TEXT,  -- Closing/goodbye message for AI agents
    
    -- Personality and System Prompt
    personality_prompt TEXT, -- System prompt/personality instructions for AI agents
    
    -- Additional Knowledge Base Content
    knowledge_base_text TEXT, -- Additional knowledge base content (beyond FAQs)
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- One knowledge base per business
    CONSTRAINT voice_agent_knowledge_base_business_id_unique 
        UNIQUE (business_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_voice_agent_knowledge_base_business_id 
    ON voice_agent_knowledge_base(business_id);

-- Enable RLS
ALTER TABLE voice_agent_knowledge_base ENABLE ROW LEVEL SECURITY;

-- RLS Policies for Knowledge Base
-- Users can view knowledge base for businesses they have access to
CREATE POLICY "Users can view knowledge base for their businesses"
    ON voice_agent_knowledge_base
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_knowledge_base.business_id
            AND ur.active = true
        )
    );

-- Owners/admins can create knowledge base entries for their businesses
CREATE POLICY "Owners/admins can create knowledge base"
    ON voice_agent_knowledge_base
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_knowledge_base.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

-- Owners/admins can update knowledge base for their businesses
CREATE POLICY "Owners/admins can update knowledge base"
    ON voice_agent_knowledge_base
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_knowledge_base.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_knowledge_base.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

-- Owners/admins can delete knowledge base for their businesses
CREATE POLICY "Owners/admins can delete knowledge base"
    ON voice_agent_knowledge_base
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_knowledge_base.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_voice_agent_knowledge_base_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS voice_agent_knowledge_base_updated_at ON voice_agent_knowledge_base;
CREATE TRIGGER voice_agent_knowledge_base_updated_at
    BEFORE UPDATE ON voice_agent_knowledge_base
    FOR EACH ROW
    EXECUTE FUNCTION update_voice_agent_knowledge_base_updated_at();

-- Add comments
COMMENT ON TABLE voice_agent_knowledge_base IS 'Business-scoped knowledge base configuration shared across all AI agents (voice, SMS, email)';
COMMENT ON COLUMN voice_agent_knowledge_base.first_message IS 'Opening greeting message for AI agents';
COMMENT ON COLUMN voice_agent_knowledge_base.last_message IS 'Closing/goodbye message for AI agents';
COMMENT ON COLUMN voice_agent_knowledge_base.personality_prompt IS 'System prompt/personality instructions for AI agents';
COMMENT ON COLUMN voice_agent_knowledge_base.knowledge_base_text IS 'Additional knowledge base content beyond FAQs';

-- Verification queries (commented out, can be run separately to verify)
/*
-- Verify table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'voice_agent_knowledge_base'
ORDER BY ordinal_position;

-- Verify unique constraint
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'voice_agent_knowledge_base'
AND constraint_type = 'UNIQUE';
*/
