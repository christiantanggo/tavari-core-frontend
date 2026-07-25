-- ============================================
-- Migrate FAQs from agent-scoped to business-scoped
-- ============================================
-- This migration removes the agent_id foreign key from voice_agent_faqs
-- and makes FAQs shared across all agents for a business

-- Step 1: Ensure all FAQs have business_id populated from their agent
-- (This should already be the case, but we'll verify and fix if needed)
UPDATE voice_agent_faqs faq
SET business_id = va.business_id
FROM voice_agents va
WHERE faq.agent_id = va.id
  AND (faq.business_id IS NULL OR faq.business_id != va.business_id);

-- Step 2: Drop the index that includes agent_id
DROP INDEX IF EXISTS idx_voice_agent_faqs_active;
DROP INDEX IF EXISTS idx_voice_agent_faqs_agent_id;

-- Step 3: Drop the foreign key constraint on agent_id
DO $$
BEGIN
    -- Check if the constraint exists and drop it
    IF EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'voice_agent_faqs_agent_id_fkey'
        AND table_name = 'voice_agent_faqs'
    ) THEN
        ALTER TABLE voice_agent_faqs 
        DROP CONSTRAINT voice_agent_faqs_agent_id_fkey;
        RAISE NOTICE 'Dropped foreign key constraint: voice_agent_faqs_agent_id_fkey';
    ELSE
        RAISE NOTICE 'Foreign key constraint voice_agent_faqs_agent_id_fkey does not exist';
    END IF;
END $$;

-- Step 4: Drop the agent_id column
DO $$
BEGIN
    -- Check if the column exists and drop it
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'voice_agent_faqs'
        AND column_name = 'agent_id'
    ) THEN
        ALTER TABLE voice_agent_faqs DROP COLUMN agent_id;
        RAISE NOTICE 'Dropped column: agent_id';
    ELSE
        RAISE NOTICE 'Column agent_id does not exist';
    END IF;
END $$;

-- Step 5: Ensure business_id column is NOT NULL
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

-- Step 7: Update RLS policies to use business_id only (they already do, but let's verify)
-- The existing policies use business_id, so they should work as-is
-- We'll drop and recreate them to ensure they're correct

DROP POLICY IF EXISTS "Users can view FAQs for their businesses" ON voice_agent_faqs;
DROP POLICY IF EXISTS "Owners/admins can create FAQs" ON voice_agent_faqs;
DROP POLICY IF EXISTS "Owners/admins can update FAQs" ON voice_agent_faqs;
DROP POLICY IF EXISTS "Owners/admins can delete FAQs" ON voice_agent_faqs;

-- Users can view FAQs for businesses they have access to
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

-- Owners/admins can create FAQs for their businesses
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

-- Owners/admins can update FAQs for their businesses
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

-- Owners/admins can delete FAQs for their businesses
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

-- Step 8: Add comment to document the change
COMMENT ON TABLE voice_agent_faqs IS 'FAQ entries for voice agents - business-scoped, shared across all agents';
COMMENT ON COLUMN voice_agent_faqs.business_id IS 'Business ID - FAQs are shared across all agents for this business';

-- Verification queries (commented out, can be run separately to verify)
/*
-- Verify no agent_id references remain
SELECT COUNT(*) as faqs_with_agent_id
FROM information_schema.columns 
WHERE table_name = 'voice_agent_faqs' 
AND column_name = 'agent_id';

-- Verify all FAQs have business_id
SELECT COUNT(*) as faqs_without_business_id
FROM voice_agent_faqs 
WHERE business_id IS NULL;

-- Verify indexes
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'voice_agent_faqs'
ORDER BY indexname;
*/
