-- ============================================
-- RUN THIS IN SUPABASE SQL EDITOR
-- ============================================
-- Copy ALL of this, paste in SQL Editor, Run.
-- If a query errors with "relation X does not exist", that TABLE is missing.
-- Check each result tab to see: (1) which tables exist, (2) their columns, (3) where participants are.
-- ============================================

-- QUERY 1: Which of these tables EXIST?
SELECT table_name,
       CASE WHEN table_name IS NOT NULL THEN 'EXISTS' END AS status
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('waiver_participants', 'booking_customer_participants', 'pos_loyalty_accounts')
ORDER BY table_name;

-- QUERY 2: All columns in waiver_participants (empty = table missing)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'waiver_participants'
ORDER BY ordinal_position;

-- QUERY 3: All columns in booking_customer_participants (empty = table missing)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'booking_customer_participants'
ORDER BY ordinal_position;

-- QUERY 4: Row count in waiver_participants (errors if table missing)
SELECT 'waiver_participants' AS table_name, COUNT(*) AS row_count FROM waiver_participants;

-- QUERY 5: Row count in booking_customer_participants (errors if table missing)
SELECT 'booking_customer_participants' AS table_name, COUNT(*) AS row_count FROM booking_customer_participants;

-- QUERY 6: Last 20 rows in waiver_participants (errors if table missing; check if customer_id column exists)
SELECT id, customer_id, business_id, first_name, last_name, date_of_birth, is_account_owner, is_active, created_at
FROM waiver_participants
ORDER BY created_at DESC NULLS LAST
LIMIT 20;

-- QUERY 7: Last 20 rows in booking_customer_participants (errors if table missing)
SELECT id, customer_id, business_id, first_name, last_name, date_of_birth, is_account_owner, is_active, created_at
FROM booking_customer_participants
ORDER BY created_at DESC NULLS LAST
LIMIT 20;

-- QUERY 8: Participants in waiver_participants with customer_id set (portal reads these)
-- If this errors with "column customer_id does not exist", run bookings_portal_participants_COMPLETE.sql first.
SELECT id, customer_id, business_id, first_name, last_name, is_account_owner, created_at
FROM waiver_participants
WHERE customer_id IS NOT NULL
ORDER BY created_at DESC NULLS LAST
LIMIT 50;
