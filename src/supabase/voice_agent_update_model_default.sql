-- ============================================
-- Update Model Default to gpt-4o-mini
-- ============================================
-- This ensures all new agents (including self-serve signups) use the cost-effective model
-- Saves ~85% on AI costs ($0.67/min → ~$0.10/min)

-- Step 1: Update database schema default for new agents
ALTER TABLE voice_agents 
ALTER COLUMN model_name SET DEFAULT 'gpt-4o-mini';

-- Step 2: Update existing agents using expensive gpt-4 (optional - uncomment to apply)
-- This will update existing agents to use the cheaper model
-- UPDATE voice_agents 
-- SET model_name = 'gpt-4o-mini'
-- WHERE (model_name = 'gpt-4' OR model_name IS NULL)
-- AND is_active = true;  -- Only update active agents

-- Step 3: Update configuration table default
ALTER TABLE voice_agent_configurations 
ALTER COLUMN default_model SET DEFAULT 'gpt-4o-mini';

-- Verification: Check the defaults are set correctly
SELECT 
    'voice_agents.model_name default' as setting,
    column_default
FROM information_schema.columns
WHERE table_name = 'voice_agents' 
AND column_name = 'model_name'

UNION ALL

SELECT 
    'voice_agent_configurations.default_model default' as setting,
    column_default
FROM information_schema.columns
WHERE table_name = 'voice_agent_configurations' 
AND column_name = 'default_model';
