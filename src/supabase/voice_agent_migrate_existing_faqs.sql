-- ============================================
-- Migrate Existing FAQs from Agent-Scoped to Business-Scoped
-- ============================================
-- This script migrates existing FAQs that are linked to agents
-- to be business-scoped (shared across all agents)

-- Step 1: Verify current FAQ structure
SELECT 
    'Current FAQ Count' as description,
    COUNT(*) as count
FROM voice_agent_faqs
UNION ALL
SELECT 
    'FAQs with agent_id' as description,
    COUNT(*) as count
FROM voice_agent_faqs
WHERE agent_id IS NOT NULL
UNION ALL
SELECT 
    'FAQs with business_id' as description,
    COUNT(*) as count
FROM voice_agent_faqs
WHERE business_id IS NOT NULL;

-- Step 2: Ensure all FAQs have business_id populated
-- (This should have been done by the schema migration, but verify)
UPDATE voice_agent_faqs faq
SET business_id = va.business_id
FROM voice_agents va
WHERE faq.agent_id = va.id
  AND (faq.business_id IS NULL OR faq.business_id != va.business_id);

-- Step 3: Handle duplicate FAQs across agents
-- For FAQs with the same question/answer across different agents in the same business,
-- we'll keep the one with the lowest display_order or oldest created_at

-- First, identify potential duplicates within each business
CREATE TEMP TABLE IF NOT EXISTS duplicate_faqs AS
SELECT 
    faq1.business_id,
    faq1.question,
    faq1.answer,
    faq1.id as faq_id,
    faq1.agent_id,
    faq1.display_order,
    faq1.created_at,
    ROW_NUMBER() OVER (
        PARTITION BY faq1.business_id, LOWER(TRIM(faq1.question)), LOWER(TRIM(faq1.answer))
        ORDER BY faq1.display_order ASC, faq1.created_at ASC
    ) as rn
FROM voice_agent_faqs faq1
WHERE faq1.agent_id IS NOT NULL;

-- Mark duplicates that should be deleted (keep first one, delete rest)
-- Note: This is a reporting query - actual deletion should be reviewed first
SELECT 
    'Potential duplicates to review' as description,
    COUNT(*) as count
FROM duplicate_faqs
WHERE rn > 1;

-- Step 4: Report on FAQ distribution by business
SELECT 
    va.business_id,
    b.name as business_name,
    COUNT(DISTINCT faq.id) as total_faqs,
    COUNT(DISTINCT faq.agent_id) as agents_with_faqs
FROM voice_agent_faqs faq
JOIN voice_agents va ON faq.agent_id = va.id
JOIN businesses b ON va.business_id = b.id
GROUP BY va.business_id, b.name
ORDER BY total_faqs DESC;

-- Step 5: Summary report before migration
SELECT 
    '=== MIGRATION SUMMARY ===' as section,
    NULL as metric,
    NULL as value
UNION ALL
SELECT 
    'Total FAQs to migrate' as section,
    CAST(COUNT(*) AS TEXT) as metric,
    NULL as value
FROM voice_agent_faqs
WHERE agent_id IS NOT NULL
UNION ALL
SELECT 
    'Unique businesses with FAQs' as section,
    CAST(COUNT(DISTINCT business_id) AS TEXT) as metric,
    NULL as value
FROM voice_agent_faqs
WHERE business_id IS NOT NULL
UNION ALL
SELECT 
    'FAQs with business_id populated' as section,
    CAST(COUNT(*) AS TEXT) as metric,
    NULL as value
FROM voice_agent_faqs
WHERE business_id IS NOT NULL;

-- IMPORTANT NOTES:
-- 1. The schema migration (voice_agent_migrate_faqs_to_business_scoped.sql) should be run FIRST
-- 2. This script is for reporting and verification only
-- 3. After the schema migration removes agent_id column, FAQs will already be business-scoped
-- 4. Review duplicate FAQs manually before any deletions
-- 5. After migration, all FAQs will be shared across all agents for each business

-- Verification queries (run after schema migration):
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

-- Verify FAQs are accessible by business
SELECT 
    business_id,
    COUNT(*) as faq_count,
    COUNT(*) FILTER (WHERE is_active = true) as active_faq_count
FROM voice_agent_faqs
GROUP BY business_id
ORDER BY faq_count DESC;
*/
