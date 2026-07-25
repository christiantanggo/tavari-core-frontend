-- ============================================
-- INSPECT EXISTING SCHEMA FOR BOOKINGS MODULE
-- ============================================
-- Run these queries to check what already exists in the database
-- This helps identify conflicts before creating the Bookings module

-- ============================================
-- 1. CHECK IF BOOKING TABLES ALREADY EXIST
-- ============================================
SELECT 
  'BOOKING TABLES CHECK' as check_type,
  table_name,
  CASE 
    WHEN table_name IN (
      'booking_types',
      'booking_activities',
      'booking_sessions',
      'bookings',
      'booking_participants',
      'booking_addons',
      'booking_addon_items',
      'booking_payments',
      'booking_notifications',
      'booking_settings'
    ) THEN '⚠️ EXISTS - CONFLICT!'
    ELSE '✅ Does not exist'
  END as status
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'booking%'
ORDER BY table_name;

-- ============================================
-- 2. CHECK REFERENCED TABLES EXIST
-- ============================================
SELECT 
  'REFERENCED TABLES CHECK' as check_type,
  table_name,
  CASE 
    WHEN table_name IN ('businesses', 'users', 'pos_loyalty_accounts', 'waiver_signatures', 'pos_sales', 'mail_campaign_sends')
    THEN '✅ EXISTS'
    ELSE '❌ MISSING - WILL CAUSE FOREIGN KEY ERROR'
  END as status
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('businesses', 'users', 'pos_loyalty_accounts', 'waiver_signatures', 'pos_sales', 'mail_campaign_sends')
ORDER BY table_name;

-- ============================================
-- 3. CHECK BUSINESSES TABLE STRUCTURE
-- ============================================
SELECT 
  'BUSINESSES TABLE' as check_type,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'businesses'
ORDER BY ordinal_position;

-- ============================================
-- 4. CHECK USERS TABLE STRUCTURE
-- ============================================
SELECT 
  'USERS TABLE' as check_type,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'users'
ORDER BY ordinal_position;

-- ============================================
-- 5. CHECK POS_LOYALTY_ACCOUNTS TABLE STRUCTURE
-- ============================================
SELECT 
  'POS_LOYALTY_ACCOUNTS TABLE' as check_type,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'pos_loyalty_accounts'
ORDER BY ordinal_position;

-- ============================================
-- 6. CHECK WAIVER_SIGNATURES TABLE STRUCTURE
-- ============================================
SELECT 
  'WAIVER_SIGNATURES TABLE' as check_type,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'waiver_signatures'
ORDER BY ordinal_position;

-- ============================================
-- 7. CHECK POS_SALES TABLE STRUCTURE
-- ============================================
SELECT 
  'POS_SALES TABLE' as check_type,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'pos_sales'
ORDER BY ordinal_position;

-- ============================================
-- 8. CHECK POS_PAYMENTS TABLE STRUCTURE
-- ============================================
SELECT 
  'POS_PAYMENTS TABLE' as check_type,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'pos_payments'
ORDER BY ordinal_position;

-- ============================================
-- 9. CHECK MAIL_CAMPAIGN_SENDS TABLE STRUCTURE
-- ============================================
SELECT 
  'MAIL_CAMPAIGN_SENDS TABLE' as check_type,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'mail_campaign_sends'
ORDER BY ordinal_position;

-- ============================================
-- 10. CHECK BUSINESS_USERS TABLE (FOR RLS)
-- ============================================
SELECT 
  'BUSINESS_USERS TABLE' as check_type,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'business_users'
ORDER BY ordinal_position;

-- ============================================
-- 11. CHECK EXISTING FUNCTIONS THAT MIGHT CONFLICT
-- ============================================
SELECT 
  'EXISTING FUNCTIONS' as check_type,
  routine_name,
  routine_type,
  CASE 
    WHEN routine_name IN (
      'generate_booking_number',
      'generate_booking_qr_code',
      'check_booking_availability',
      'update_session_capacity'
    ) THEN '⚠️ EXISTS - CONFLICT!'
    ELSE '✅ Does not exist'
  END as status
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name LIKE '%booking%'
ORDER BY routine_name;

-- ============================================
-- 12. CHECK EXISTING INDEXES THAT MIGHT CONFLICT
-- ============================================
SELECT 
  'EXISTING INDEXES' as check_type,
  indexname,
  tablename,
  CASE 
    WHEN indexname LIKE 'idx_booking%' THEN '⚠️ EXISTS - CONFLICT!'
    ELSE '✅ Does not exist'
  END as status
FROM pg_indexes
WHERE schemaname = 'public'
  AND (indexname LIKE 'idx_booking%' OR tablename LIKE 'booking%')
ORDER BY tablename, indexname;

-- ============================================
-- 13. CHECK EXISTING RLS POLICIES THAT MIGHT CONFLICT
-- ============================================
SELECT 
  'EXISTING RLS POLICIES' as check_type,
  schemaname,
  tablename,
  policyname,
  CASE 
    WHEN tablename LIKE 'booking%' THEN '⚠️ EXISTS - CONFLICT!'
    ELSE '✅ Does not exist'
  END as status
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename LIKE 'booking%'
ORDER BY tablename, policyname;

-- ============================================
-- 14. CHECK EXISTING TRIGGERS THAT MIGHT CONFLICT
-- ============================================
SELECT 
  'EXISTING TRIGGERS' as check_type,
  trigger_name,
  event_object_table,
  action_statement,
  CASE 
    WHEN trigger_name LIKE '%booking%' OR event_object_table LIKE 'booking%' THEN '⚠️ EXISTS - CONFLICT!'
    ELSE '✅ Does not exist'
  END as status
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND (trigger_name LIKE '%booking%' OR event_object_table LIKE 'booking%')
ORDER BY event_object_table, trigger_name;

-- ============================================
-- 15. CHECK FOREIGN KEY CONSTRAINTS ON REFERENCED TABLES
-- ============================================
SELECT 
  'FOREIGN KEY CONSTRAINTS' as check_type,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  tc.constraint_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND (tc.table_name LIKE 'booking%' OR ccu.table_name IN ('businesses', 'users', 'pos_loyalty_accounts', 'waiver_signatures', 'pos_sales'))
ORDER BY tc.table_name, kcu.column_name;

-- ============================================
-- 16. CHECK FOR EXISTING UUID EXTENSION
-- ============================================
SELECT 
  'UUID EXTENSION' as check_type,
  extname,
  extversion,
  CASE 
    WHEN extname = 'uuid-ossp' THEN '✅ EXISTS'
    ELSE '❌ MISSING - NEEDS TO BE CREATED'
  END as status
FROM pg_extension
WHERE extname = 'uuid-ossp';

-- ============================================
-- 17. SUMMARY OF POTENTIAL CONFLICTS
-- ============================================
SELECT 
  'SUMMARY' as check_type,
  'Total booking tables found' as item,
  COUNT(*)::text as value
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'booking%'

UNION ALL

SELECT 
  'SUMMARY' as check_type,
  'Total booking functions found' as item,
  COUNT(*)::text as value
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name LIKE '%booking%'

UNION ALL

SELECT 
  'SUMMARY' as check_type,
  'Total booking indexes found' as item,
  COUNT(*)::text as value
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_booking%'

UNION ALL

SELECT 
  'SUMMARY' as check_type,
  'Total booking RLS policies found' as item,
  COUNT(*)::text as value
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename LIKE 'booking%';












