-- ============================================
-- COMPLETE MIGRATION: FAQs to Business-Scoped + Knowledge Base
-- ============================================
-- Run this script to complete the full migration
-- ORDER IS IMPORTANT - run in sequence

-- ============================================
-- PART 1: Migrate FAQs from agent-scoped to business-scoped
-- ============================================

-- Step 1: Ensure all FAQs have business_id populated
UPDATE voice_agent_faqs faq
SET business_id = va.business_id
FROM voice_agents va
WHERE faq.agent_id = va.id
  AND (faq.business_id IS NULL OR faq.business_id != va.business_id);

-- Step 2: Drop indexes that include agent_id
DROP INDEX IF EXISTS idx_voice_agent_faqs_active;
DROP INDEX IF EXISTS idx_voice_agent_faqs_agent_id;

-- Step 3: Drop the foreign key constraint on agent_id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'voice_agent_faqs_agent_id_fkey'
        AND table_name = 'voice_agent_faqs'
    ) THEN
        ALTER TABLE voice_agent_faqs DROP CONSTRAINT voice_agent_faqs_agent_id_fkey;
        RAISE NOTICE 'Dropped foreign key constraint: voice_agent_faqs_agent_id_fkey';
    END IF;
END $$;

-- Step 4: Drop the agent_id column
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'voice_agent_faqs'
        AND column_name = 'agent_id'
    ) THEN
        ALTER TABLE voice_agent_faqs DROP COLUMN agent_id;
        RAISE NOTICE 'Dropped column: agent_id';
    END IF;
END $$;

-- Step 5: Ensure business_id is NOT NULL
ALTER TABLE voice_agent_faqs 
ALTER COLUMN business_id SET NOT NULL;

-- Step 6: Recreate indexes with business_id only
CREATE INDEX IF NOT EXISTS idx_voice_agent_faqs_business_id 
    ON voice_agent_faqs(business_id);

CREATE INDEX IF NOT EXISTS idx_voice_agent_faqs_active 
    ON voice_agent_faqs(business_id, is_active) 
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_voice_agent_faqs_display_order 
    ON voice_agent_faqs(business_id, display_order) 
    WHERE is_active = true;

-- Step 7: Update RLS policies to use business_id only
DROP POLICY IF EXISTS "Users can view FAQs for their businesses" ON voice_agent_faqs;
DROP POLICY IF EXISTS "Owners/admins can create FAQs" ON voice_agent_faqs;
DROP POLICY IF EXISTS "Owners/admins can update FAQs" ON voice_agent_faqs;
DROP POLICY IF EXISTS "Owners/admins can delete FAQs" ON voice_agent_faqs;

CREATE POLICY "Users can view FAQs for their businesses"
    ON voice_agent_faqs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_faqs.business_id
            AND ur.active = true
        )
    );

CREATE POLICY "Owners/admins can create FAQs"
    ON voice_agent_faqs
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_faqs.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

CREATE POLICY "Owners/admins can update FAQs"
    ON voice_agent_faqs
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_faqs.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_faqs.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

CREATE POLICY "Owners/admins can delete FAQs"
    ON voice_agent_faqs
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.business_id = voice_agent_faqs.business_id
            AND ur.active = true
            AND ur.role IN ('owner', 'manager', 'admin')
        )
    );

-- ============================================
-- PART 2: Create Knowledge Base Table
-- ============================================

CREATE TABLE IF NOT EXISTS voice_agent_knowledge_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    
    -- Message Configuration
    first_message TEXT,
    last_message TEXT,
    
    -- Personality and System Prompt
    personality_prompt TEXT,
    
    -- Additional Knowledge Base Content
    knowledge_base_text TEXT,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- One knowledge base per business
    CONSTRAINT voice_agent_knowledge_base_business_id_unique 
        UNIQUE (business_id)
);

CREATE INDEX IF NOT EXISTS idx_voice_agent_knowledge_base_business_id 
    ON voice_agent_knowledge_base(business_id);

ALTER TABLE voice_agent_knowledge_base ENABLE ROW LEVEL SECURITY;

-- RLS Policies for Knowledge Base
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

-- Trigger for updated_at
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

-- ============================================
-- PART 3: Migrate Agent Settings to Knowledge Base
-- ============================================

INSERT INTO voice_agent_knowledge_base (business_id, first_message, personality_prompt, created_at, updated_at)
SELECT DISTINCT ON (business_id)
    business_id,
    COALESCE(
        (SELECT first_message FROM voice_agents va2 
         WHERE va2.business_id = va.business_id 
         AND va2.first_message IS NOT NULL 
         AND va2.first_message != ''
         LIMIT 1),
        'Hello! How can I help you today?'
    ) as first_message,
    COALESCE(
        (SELECT system_prompt FROM voice_agents va3 
         WHERE va3.business_id = va.business_id 
         AND va3.system_prompt IS NOT NULL 
         AND va3.system_prompt != ''
         LIMIT 1),
        ''
    ) as personality_prompt,
    NOW() as created_at,
    NOW() as updated_at
FROM voice_agents va
WHERE NOT EXISTS (
    SELECT 1 FROM voice_agent_knowledge_base kb
    WHERE kb.business_id = va.business_id
)
GROUP BY business_id
ON CONFLICT (business_id) DO NOTHING;

-- Set default last_message
UPDATE voice_agent_knowledge_base
SET last_message = COALESCE(
    last_message,
    'Thanks for calling! Have a great day!'
)
WHERE last_message IS NULL OR last_message = '';

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Verify FAQs are business-scoped
SELECT 
    'FAQ Migration Verification' as check_type,
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'voice_agent_faqs' 
        AND column_name = 'agent_id'
    ) THEN 'FAIL: agent_id column still exists'
    ELSE 'PASS: agent_id column removed'
    END as status;

-- Verify FAQs count
SELECT 
    'FAQ Count' as check_type,
    COUNT(*)::text as status
FROM voice_agent_faqs;

-- Verify Knowledge Base created
SELECT 
    'Knowledge Base Count' as check_type,
    COUNT(*)::text as status
FROM voice_agent_knowledge_base;

-- Verify Knowledge Base has data
SELECT 
    kb.business_id,
    b.name as business_name,
    CASE WHEN kb.first_message IS NOT NULL AND kb.first_message != '' THEN 'Yes' ELSE 'No' END as has_first_message,
    CASE WHEN kb.personality_prompt IS NOT NULL AND kb.personality_prompt != '' THEN 'Yes' ELSE 'No' END as has_personality
FROM voice_agent_knowledge_base kb
JOIN businesses b ON kb.business_id = b.id;

