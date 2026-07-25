-- ============================================
-- Update Knowledge Base Schema for New Structure
-- ============================================
-- This migration adds support for:
-- - Important Rules
-- - Policies
-- - Products & Pricing
-- - Promos
-- - FAQ Categories
-- - Personality type (dropdown instead of free text)

-- Step 1: Add new columns to voice_agent_knowledge_base
ALTER TABLE voice_agent_knowledge_base
ADD COLUMN IF NOT EXISTS personality_type TEXT, -- Dropdown selection instead of free text
ADD COLUMN IF NOT EXISTS products_pricing TEXT, -- Products and pricing information
ADD COLUMN IF NOT EXISTS layout_answer_message TEXT, -- How calls are answered (renamed from first_message)
ADD COLUMN IF NOT EXISTS layout_end_message TEXT; -- How calls are ended (renamed from last_message)

-- Step 2: Migrate existing data
UPDATE voice_agent_knowledge_base
SET 
  layout_answer_message = COALESCE(first_message, ''),
  layout_end_message = COALESCE(last_message, '')
WHERE layout_answer_message IS NULL OR layout_end_message IS NULL;

-- Step 3: Create Important Rules table
CREATE TABLE IF NOT EXISTS voice_agent_important_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    rule_name TEXT NOT NULL,
    rule_description TEXT NOT NULL,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_agent_important_rules_business_id 
    ON voice_agent_important_rules(business_id);

CREATE INDEX IF NOT EXISTS idx_voice_agent_important_rules_active 
    ON voice_agent_important_rules(business_id, is_active) 
    WHERE is_active = true;

ALTER TABLE voice_agent_important_rules ENABLE ROW LEVEL SECURITY;

-- RLS Policies for Important Rules
CREATE POLICY "Users can view important rules for their businesses"
    ON voice_agent_important_rules
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_important_rules.business_id
            AND ur.active = true
        )
    );

CREATE POLICY "Owners/admins can create important rules"
    ON voice_agent_important_rules
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_important_rules.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

CREATE POLICY "Owners/admins can update important rules"
    ON voice_agent_important_rules
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_important_rules.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_important_rules.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

CREATE POLICY "Owners/admins can delete important rules"
    ON voice_agent_important_rules
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_important_rules.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

-- Step 4: Create Policies table
CREATE TABLE IF NOT EXISTS voice_agent_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    policy_name TEXT NOT NULL,
    policy_details TEXT NOT NULL,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_agent_policies_business_id 
    ON voice_agent_policies(business_id);

CREATE INDEX IF NOT EXISTS idx_voice_agent_policies_active 
    ON voice_agent_policies(business_id, is_active) 
    WHERE is_active = true;

ALTER TABLE voice_agent_policies ENABLE ROW LEVEL SECURITY;

-- RLS Policies for Policies (same pattern as Important Rules)
CREATE POLICY "Users can view policies for their businesses"
    ON voice_agent_policies
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_policies.business_id
            AND ur.active = true
        )
    );

CREATE POLICY "Owners/admins can create policies"
    ON voice_agent_policies
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_policies.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

CREATE POLICY "Owners/admins can update policies"
    ON voice_agent_policies
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_policies.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_policies.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

CREATE POLICY "Owners/admins can delete policies"
    ON voice_agent_policies
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_policies.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

-- Step 5: Create Promos table
CREATE TABLE IF NOT EXISTS voice_agent_promos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_voice_agent_promos_business_id 
    ON voice_agent_promos(business_id);

CREATE INDEX IF NOT EXISTS idx_voice_agent_promos_active 
    ON voice_agent_promos(business_id, is_active) 
    WHERE is_active = true;

ALTER TABLE voice_agent_promos ENABLE ROW LEVEL SECURITY;

-- RLS Policies for Promos
CREATE POLICY "Users can view promos for their businesses"
    ON voice_agent_promos
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_promos.business_id
            AND ur.active = true
        )
    );

CREATE POLICY "Owners/admins can create promos"
    ON voice_agent_promos
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_promos.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

CREATE POLICY "Owners/admins can update promos"
    ON voice_agent_promos
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_promos.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_promos.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

CREATE POLICY "Owners/admins can delete promos"
    ON voice_agent_promos
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_promos.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

-- Step 6: Add category column to FAQs table
ALTER TABLE voice_agent_faqs
ADD COLUMN IF NOT EXISTS category TEXT;

CREATE INDEX IF NOT EXISTS idx_voice_agent_faqs_category 
    ON voice_agent_faqs(business_id, category) 
    WHERE category IS NOT NULL;

-- Step 7: Create triggers for updated_at
CREATE OR REPLACE FUNCTION update_voice_agent_important_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_voice_agent_policies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_voice_agent_promos_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS voice_agent_important_rules_updated_at ON voice_agent_important_rules;
CREATE TRIGGER voice_agent_important_rules_updated_at
    BEFORE UPDATE ON voice_agent_important_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_voice_agent_important_rules_updated_at();

DROP TRIGGER IF EXISTS voice_agent_policies_updated_at ON voice_agent_policies;
CREATE TRIGGER voice_agent_policies_updated_at
    BEFORE UPDATE ON voice_agent_policies
    FOR EACH ROW
    EXECUTE FUNCTION update_voice_agent_policies_updated_at();

DROP TRIGGER IF EXISTS voice_agent_promos_updated_at ON voice_agent_promos;
CREATE TRIGGER voice_agent_promos_updated_at
    BEFORE UPDATE ON voice_agent_promos
    FOR EACH ROW
    EXECUTE FUNCTION update_voice_agent_promos_updated_at();

-- Step 8: Add comments
COMMENT ON COLUMN voice_agent_knowledge_base.personality_type IS 'Personality type selected from dropdown (friendly, professional, etc.)';
COMMENT ON COLUMN voice_agent_knowledge_base.products_pricing IS 'Products and pricing information';
COMMENT ON COLUMN voice_agent_knowledge_base.layout_answer_message IS 'How calls are answered (renamed from first_message)';
COMMENT ON COLUMN voice_agent_knowledge_base.layout_end_message IS 'How calls are ended (renamed from last_message)';
COMMENT ON COLUMN voice_agent_faqs.category IS 'Category for organizing FAQs';

COMMENT ON TABLE voice_agent_important_rules IS 'Important rules for AI agents (rule name + description)';
COMMENT ON TABLE voice_agent_policies IS 'Business policies (policy name + details)';
COMMENT ON TABLE voice_agent_promos IS 'Promotional offers with mention timing options';

