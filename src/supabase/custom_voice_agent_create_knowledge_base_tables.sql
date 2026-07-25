-- ============================================
-- Custom AI Voice Agent - Knowledge Base Schema
-- ============================================
-- This creates knowledge base tables for the Custom AI Voice Agent module
-- Uses custom_voice_agent_ prefix to distinguish from existing voice_agent tables

-- Step 1: Create Knowledge Base table
CREATE TABLE IF NOT EXISTS custom_voice_agent_knowledge_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL,
    
    -- Message Configuration
    first_message TEXT, -- Opening greeting message for AI agents
    last_message TEXT,  -- Closing/goodbye message for AI agents
    
    -- Personality and System Prompt
    personality_prompt TEXT, -- System prompt/personality instructions for AI agents
    personality_type TEXT, -- Dropdown selection (friendly, professional, etc.)
    
    -- Additional Knowledge Base Content
    knowledge_base_text TEXT, -- Additional knowledge base content (beyond FAQs)
    products_pricing TEXT, -- Products and pricing information
    
    -- Layout Messages (renamed from first_message/last_message)
    layout_answer_message TEXT, -- How calls are answered
    layout_end_message TEXT, -- How calls are ended
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- One knowledge base per business
    UNIQUE (business_id)
);

-- Add foreign key and unique constraint for knowledge base
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_knowledge_base_business_id_fkey'
    ) THEN
        ALTER TABLE custom_voice_agent_knowledge_base
        ADD CONSTRAINT custom_voice_agent_knowledge_base_business_id_fkey 
            FOREIGN KEY (business_id) 
            REFERENCES businesses(id) 
            ON DELETE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_knowledge_base_business_id_unique'
    ) THEN
        ALTER TABLE custom_voice_agent_knowledge_base
        ADD CONSTRAINT custom_voice_agent_knowledge_base_business_id_unique 
            UNIQUE (business_id);
    END IF;
END $$;

-- Step 2: Create FAQs table
CREATE TABLE IF NOT EXISTS custom_voice_agent_faqs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL,
    agent_id UUID, -- NULL = business-scoped
    
    -- FAQ Information
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    category TEXT, -- Category for organizing FAQs
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add foreign keys for FAQs table
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_faqs_business_id_fkey'
    ) THEN
        ALTER TABLE custom_voice_agent_faqs
        ADD CONSTRAINT custom_voice_agent_faqs_business_id_fkey 
            FOREIGN KEY (business_id) 
            REFERENCES businesses(id) 
            ON DELETE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_faqs_agent_id_fkey'
    ) THEN
        ALTER TABLE custom_voice_agent_faqs
        ADD CONSTRAINT custom_voice_agent_faqs_agent_id_fkey 
            FOREIGN KEY (agent_id) 
            REFERENCES custom_voice_agents(id) 
            ON DELETE CASCADE;
    END IF;
END $$;

-- Step 3: Create Important Rules table
CREATE TABLE IF NOT EXISTS custom_voice_agent_important_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL,
    rule_name TEXT NOT NULL,
    rule_description TEXT NOT NULL,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add foreign key for Important Rules table
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_important_rules_business_id_fkey'
    ) THEN
        ALTER TABLE custom_voice_agent_important_rules
        ADD CONSTRAINT custom_voice_agent_important_rules_business_id_fkey 
            FOREIGN KEY (business_id) 
            REFERENCES businesses(id) 
            ON DELETE CASCADE;
    END IF;
END $$;

-- Step 4: Create Policies table
CREATE TABLE IF NOT EXISTS custom_voice_agent_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL,
    policy_name TEXT NOT NULL,
    policy_details TEXT NOT NULL,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add foreign key for Policies table
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_policies_business_id_fkey'
    ) THEN
        ALTER TABLE custom_voice_agent_policies
        ADD CONSTRAINT custom_voice_agent_policies_business_id_fkey 
            FOREIGN KEY (business_id) 
            REFERENCES businesses(id) 
            ON DELETE CASCADE;
    END IF;
END $$;

-- Step 5: Create Promos table
CREATE TABLE IF NOT EXISTS custom_voice_agent_promos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL,
    promo_name TEXT NOT NULL,
    promo_details TEXT NOT NULL,
    mention_at_start BOOLEAN DEFAULT false,
    mention_before_end BOOLEAN DEFAULT false,
    mention_casually BOOLEAN DEFAULT false,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add foreign key for Promos table
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'custom_voice_agent_promos_business_id_fkey'
    ) THEN
        ALTER TABLE custom_voice_agent_promos
        ADD CONSTRAINT custom_voice_agent_promos_business_id_fkey 
            FOREIGN KEY (business_id) 
            REFERENCES businesses(id) 
            ON DELETE CASCADE;
    END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_knowledge_base_business_id 
    ON custom_voice_agent_knowledge_base(business_id);

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_faqs_business_id 
    ON custom_voice_agent_faqs(business_id);

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_faqs_agent_id 
    ON custom_voice_agent_faqs(agent_id);

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_faqs_category 
    ON custom_voice_agent_faqs(business_id, category) 
    WHERE category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_important_rules_business_id 
    ON custom_voice_agent_important_rules(business_id);

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_important_rules_active 
    ON custom_voice_agent_important_rules(business_id, is_active) 
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_policies_business_id 
    ON custom_voice_agent_policies(business_id);

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_policies_active 
    ON custom_voice_agent_policies(business_id, is_active) 
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_promos_business_id 
    ON custom_voice_agent_promos(business_id);

CREATE INDEX IF NOT EXISTS idx_custom_voice_agent_promos_active 
    ON custom_voice_agent_promos(business_id, is_active) 
    WHERE is_active = true;

-- Enable RLS
ALTER TABLE custom_voice_agent_knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_voice_agent_faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_voice_agent_important_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_voice_agent_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_voice_agent_promos ENABLE ROW LEVEL SECURITY;

-- RLS Policies for Knowledge Base (drop if exists first)
DROP POLICY IF EXISTS "Users can view knowledge base for their businesses" ON custom_voice_agent_knowledge_base;
CREATE POLICY "Users can view knowledge base for their businesses"
    ON custom_voice_agent_knowledge_base
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_knowledge_base.business_id
            AND ur.active = true
        )
    );

DROP POLICY IF EXISTS "Owners/admins can create knowledge base" ON custom_voice_agent_knowledge_base;
CREATE POLICY "Owners/admins can create knowledge base"
    ON custom_voice_agent_knowledge_base
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_knowledge_base.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

DROP POLICY IF EXISTS "Owners/admins can update knowledge base" ON custom_voice_agent_knowledge_base;
CREATE POLICY "Owners/admins can update knowledge base"
    ON custom_voice_agent_knowledge_base
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_knowledge_base.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_knowledge_base.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

DROP POLICY IF EXISTS "Owners/admins can delete knowledge base" ON custom_voice_agent_knowledge_base;
CREATE POLICY "Owners/admins can delete knowledge base"
    ON custom_voice_agent_knowledge_base
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_knowledge_base.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

-- RLS Policies for FAQs (same pattern) - drop if exists first
DROP POLICY IF EXISTS "Users can view FAQs for their businesses" ON custom_voice_agent_faqs;
CREATE POLICY "Users can view FAQs for their businesses"
    ON custom_voice_agent_faqs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_faqs.business_id
            AND ur.active = true
        )
    );

DROP POLICY IF EXISTS "Owners/admins can create FAQs" ON custom_voice_agent_faqs;
CREATE POLICY "Owners/admins can create FAQs"
    ON custom_voice_agent_faqs
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_faqs.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

DROP POLICY IF EXISTS "Owners/admins can update FAQs" ON custom_voice_agent_faqs;
CREATE POLICY "Owners/admins can update FAQs"
    ON custom_voice_agent_faqs
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_faqs.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_faqs.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

DROP POLICY IF EXISTS "Owners/admins can delete FAQs" ON custom_voice_agent_faqs;
CREATE POLICY "Owners/admins can delete FAQs"
    ON custom_voice_agent_faqs
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_faqs.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

-- RLS Policies for Important Rules - drop if exists first
DROP POLICY IF EXISTS "Users can view important rules for their businesses" ON custom_voice_agent_important_rules;
CREATE POLICY "Users can view important rules for their businesses"
    ON custom_voice_agent_important_rules
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_important_rules.business_id
            AND ur.active = true
        )
    );

DROP POLICY IF EXISTS "Owners/admins can create important rules" ON custom_voice_agent_important_rules;
CREATE POLICY "Owners/admins can create important rules"
    ON custom_voice_agent_important_rules
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_important_rules.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

DROP POLICY IF EXISTS "Owners/admins can update important rules" ON custom_voice_agent_important_rules;
CREATE POLICY "Owners/admins can update important rules"
    ON custom_voice_agent_important_rules
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_important_rules.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_important_rules.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

DROP POLICY IF EXISTS "Owners/admins can delete important rules" ON custom_voice_agent_important_rules;
CREATE POLICY "Owners/admins can delete important rules"
    ON custom_voice_agent_important_rules
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_important_rules.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

-- RLS Policies for Policies - drop if exists first
DROP POLICY IF EXISTS "Users can view policies for their businesses" ON custom_voice_agent_policies;
CREATE POLICY "Users can view policies for their businesses"
    ON custom_voice_agent_policies
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_policies.business_id
            AND ur.active = true
        )
    );

DROP POLICY IF EXISTS "Owners/admins can create policies" ON custom_voice_agent_policies;
CREATE POLICY "Owners/admins can create policies"
    ON custom_voice_agent_policies
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_policies.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

DROP POLICY IF EXISTS "Owners/admins can update policies" ON custom_voice_agent_policies;
CREATE POLICY "Owners/admins can update policies"
    ON custom_voice_agent_policies
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_policies.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_policies.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

DROP POLICY IF EXISTS "Owners/admins can delete policies" ON custom_voice_agent_policies;
CREATE POLICY "Owners/admins can delete policies"
    ON custom_voice_agent_policies
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_policies.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

-- RLS Policies for Promos - drop if exists first
DROP POLICY IF EXISTS "Users can view promos for their businesses" ON custom_voice_agent_promos;
CREATE POLICY "Users can view promos for their businesses"
    ON custom_voice_agent_promos
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_promos.business_id
            AND ur.active = true
        )
    );

DROP POLICY IF EXISTS "Owners/admins can create promos" ON custom_voice_agent_promos;
CREATE POLICY "Owners/admins can create promos"
    ON custom_voice_agent_promos
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_promos.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

DROP POLICY IF EXISTS "Owners/admins can update promos" ON custom_voice_agent_promos;
CREATE POLICY "Owners/admins can update promos"
    ON custom_voice_agent_promos
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_promos.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_promos.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

DROP POLICY IF EXISTS "Owners/admins can delete promos" ON custom_voice_agent_promos;
CREATE POLICY "Owners/admins can delete promos"
    ON custom_voice_agent_promos
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = custom_voice_agent_promos.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

-- Create triggers for updated_at
CREATE OR REPLACE FUNCTION update_custom_voice_agent_knowledge_base_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_custom_voice_agent_faqs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_custom_voice_agent_important_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_custom_voice_agent_policies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_custom_voice_agent_promos_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS custom_voice_agent_knowledge_base_updated_at ON custom_voice_agent_knowledge_base;
CREATE TRIGGER custom_voice_agent_knowledge_base_updated_at
    BEFORE UPDATE ON custom_voice_agent_knowledge_base
    FOR EACH ROW
    EXECUTE FUNCTION update_custom_voice_agent_knowledge_base_updated_at();

DROP TRIGGER IF EXISTS custom_voice_agent_faqs_updated_at ON custom_voice_agent_faqs;
CREATE TRIGGER custom_voice_agent_faqs_updated_at
    BEFORE UPDATE ON custom_voice_agent_faqs
    FOR EACH ROW
    EXECUTE FUNCTION update_custom_voice_agent_faqs_updated_at();

DROP TRIGGER IF EXISTS custom_voice_agent_important_rules_updated_at ON custom_voice_agent_important_rules;
CREATE TRIGGER custom_voice_agent_important_rules_updated_at
    BEFORE UPDATE ON custom_voice_agent_important_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_custom_voice_agent_important_rules_updated_at();

DROP TRIGGER IF EXISTS custom_voice_agent_policies_updated_at ON custom_voice_agent_policies;
CREATE TRIGGER custom_voice_agent_policies_updated_at
    BEFORE UPDATE ON custom_voice_agent_policies
    FOR EACH ROW
    EXECUTE FUNCTION update_custom_voice_agent_policies_updated_at();

DROP TRIGGER IF EXISTS custom_voice_agent_promos_updated_at ON custom_voice_agent_promos;
CREATE TRIGGER custom_voice_agent_promos_updated_at
    BEFORE UPDATE ON custom_voice_agent_promos
    FOR EACH ROW
    EXECUTE FUNCTION update_custom_voice_agent_promos_updated_at();

-- Comments
COMMENT ON TABLE custom_voice_agent_knowledge_base IS 'Business-scoped knowledge base configuration for Custom AI Voice Agent';
COMMENT ON TABLE custom_voice_agent_faqs IS 'FAQs for Custom AI Voice Agent (can be business-scoped or agent-scoped)';
COMMENT ON TABLE custom_voice_agent_important_rules IS 'Important rules for Custom AI Voice Agent';
COMMENT ON TABLE custom_voice_agent_policies IS 'Business policies for Custom AI Voice Agent';
COMMENT ON TABLE custom_voice_agent_promos IS 'Promotional offers for Custom AI Voice Agent';

