-- ============================================
-- Migrate Agent Settings to Knowledge Base
-- ============================================
-- This script creates initial knowledge base records from existing agents
-- by extracting first_message and system_prompt and grouping by business_id

-- Step 1: Create knowledge base entries from existing agents
-- Group by business_id and use the first agent's values (or merge logic)
INSERT INTO voice_agent_knowledge_base (business_id, first_message, personality_prompt, created_at, updated_at)
SELECT DISTINCT ON (business_id)
    business_id,
    COALESCE(
        -- Use first_message from any agent that has it
        (SELECT first_message FROM voice_agents va2 
         WHERE va2.business_id = va.business_id 
         AND va2.first_message IS NOT NULL 
         AND va2.first_message != ''
         LIMIT 1),
        'Hello! How can I help you today?'
    ) as first_message,
    COALESCE(
        -- Use system_prompt from any agent that has it
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
    -- Only insert if knowledge base doesn't already exist for this business
    SELECT 1 FROM voice_agent_knowledge_base kb
    WHERE kb.business_id = va.business_id
)
GROUP BY business_id
ON CONFLICT (business_id) DO NOTHING;

-- Step 2: Set default last_message for knowledge bases that don't have one
UPDATE voice_agent_knowledge_base
SET last_message = COALESCE(
    last_message,
    'Thanks for calling! Have a great day!'
)
WHERE last_message IS NULL OR last_message = '';

-- Step 3: Summary report
SELECT 
    '=== KNOWLEDGE BASE MIGRATION SUMMARY ===' as section,
    NULL as metric,
    NULL as value
UNION ALL
SELECT 
    'Total businesses with agents' as section,
    CAST(COUNT(DISTINCT business_id) AS TEXT) as metric,
    NULL as value
FROM voice_agents
UNION ALL
SELECT 
    'Knowledge base entries created' as section,
    CAST(COUNT(*) AS TEXT) as metric,
    NULL as value
FROM voice_agent_knowledge_base
UNION ALL
SELECT 
    'Knowledge bases with first_message' as section,
    CAST(COUNT(*) AS TEXT) as metric,
    NULL as value
FROM voice_agent_knowledge_base
WHERE first_message IS NOT NULL AND first_message != ''
UNION ALL
SELECT 
    'Knowledge bases with personality_prompt' as section,
    CAST(COUNT(*) AS TEXT) as metric,
    NULL as value
FROM voice_agent_knowledge_base
WHERE personality_prompt IS NOT NULL AND personality_prompt != ''
UNION ALL
SELECT 
    'Knowledge bases with last_message' as section,
    CAST(COUNT(*) AS TEXT) as metric,
    NULL as value
FROM voice_agent_knowledge_base
WHERE last_message IS NOT NULL AND last_message != '';

-- Step 4: Detailed report by business
SELECT 
    kb.business_id,
    b.name as business_name,
    CASE WHEN kb.first_message IS NOT NULL AND kb.first_message != '' THEN 'Yes' ELSE 'No' END as has_first_message,
    CASE WHEN kb.last_message IS NOT NULL AND kb.last_message != '' THEN 'Yes' ELSE 'No' END as has_last_message,
    CASE WHEN kb.personality_prompt IS NOT NULL AND kb.personality_prompt != '' THEN 'Yes' ELSE 'No' END as has_personality,
    LENGTH(kb.personality_prompt) as personality_length,
    kb.created_at,
    kb.updated_at
FROM voice_agent_knowledge_base kb
JOIN businesses b ON kb.business_id = b.id
ORDER BY kb.created_at DESC;

-- IMPORTANT NOTES:
-- 1. This script should be run AFTER creating the knowledge_base table
-- 2. It will create one knowledge base entry per business
-- 3. If multiple agents have different first_message/system_prompt, it uses the first non-null one found
-- 4. Review the results and manually update knowledge bases if needed
-- 5. After migration, agents will use knowledge base values instead of their own
-- 6. The edge function will need to be updated to fetch from knowledge_base table

-- Verification queries:
/*
-- Verify all businesses with agents have knowledge base entries
SELECT 
    va.business_id,
    b.name as business_name,
    CASE WHEN kb.id IS NOT NULL THEN 'Yes' ELSE 'No' END as has_knowledge_base
FROM (SELECT DISTINCT business_id FROM voice_agents) va
JOIN businesses b ON va.business_id = b.id
LEFT JOIN voice_agent_knowledge_base kb ON va.business_id = kb.business_id
ORDER BY has_knowledge_base, business_name;
*/
