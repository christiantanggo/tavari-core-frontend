-- Voice Agent Module - Check Existing Tables and Constraints
-- Run this to see what already exists in your database

-- Check if tables exist
SELECT 
    'Tables' as type,
    table_name as name,
    'EXISTS' as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN (
    'voice_agents',
    'voice_agent_calls',
    'voice_agent_leads',
    'voice_agent_configurations'
  )
ORDER BY table_name;

-- Check if indexes exist
SELECT 
    'Indexes' as type,
    indexname as name,
    'EXISTS' as status
FROM pg_indexes 
WHERE schemaname = 'public' 
  AND indexname LIKE 'idx_voice_agent%'
ORDER BY indexname;

-- Check if constraints exist
SELECT 
    'Constraints' as type,
    conname as name,
    'EXISTS' as status
FROM pg_constraint
WHERE conrelid IN (
    SELECT oid FROM pg_class WHERE relname IN (
        'voice_agents',
        'voice_agent_calls',
        'voice_agent_leads',
        'voice_agent_configurations'
    )
)
AND conname LIKE '%voice_agent%'
ORDER BY conname;

-- Check if triggers exist
SELECT 
    'Triggers' as type,
    trigger_name as name,
    'EXISTS' as status
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name LIKE '%voice_agent%'
ORDER BY trigger_name;

-- Check if functions exist
SELECT 
    'Functions' as type,
    routine_name as name,
    'EXISTS' as status
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name LIKE '%voice_agent%'
ORDER BY routine_name;

-- Check RLS policies
SELECT 
    'RLS Policies' as type,
    policyname as name,
    tablename as table_name,
    'EXISTS' as status
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'voice_agents',
    'voice_agent_calls',
    'voice_agent_leads',
    'voice_agent_configurations'
  )
ORDER BY tablename, policyname;

-- Check if module is in catalog
SELECT 
    'Module Catalog' as type,
    module_key as name,
    module_name,
    'EXISTS' as status
FROM app_modules
WHERE module_key = 'voice_agent';


