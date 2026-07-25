-- Diagnostic SQL queries for November pay statements issue
-- Run these queries in Supabase SQL Editor to diagnose why November entries aren't appearing

-- ============================================================================
-- STEP 1: Check if November payroll runs exist for this business
-- ============================================================================
-- Replace 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc' with the actual business_id
-- Replace 'f3693c3b-7650-40b8-a93d-b0bac4c61d79' with the actual user_id

-- Check November payroll runs (by pay_period_end)
SELECT 
    id,
    business_id,
    pay_period_start,
    pay_period_end,
    pay_date,
    status,
    created_at
FROM hrpayroll_runs
WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
  AND pay_period_end >= '2025-11-01'
  AND pay_period_end <= '2025-11-30'
ORDER BY pay_date DESC;

-- Check November payroll runs (by pay_date)
SELECT 
    id,
    business_id,
    pay_period_start,
    pay_period_end,
    pay_date,
    status,
    created_at
FROM hrpayroll_runs
WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
  AND pay_date >= '2025-11-01'
  AND pay_date <= '2025-11-30'
ORDER BY pay_date DESC;

-- Combined November runs (either pay_period_end or pay_date in November)
SELECT 
    id,
    business_id,
    pay_period_start,
    pay_period_end,
    pay_date,
    status,
    created_at,
    CASE 
        WHEN pay_period_end >= '2025-11-01' AND pay_period_end <= '2025-11-30' THEN 'pay_period_end'
        WHEN pay_date >= '2025-11-01' AND pay_date <= '2025-11-30' THEN 'pay_date'
    END as november_match_type
FROM hrpayroll_runs
WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
  AND (
    (pay_period_end >= '2025-11-01' AND pay_period_end <= '2025-11-30')
    OR (pay_date >= '2025-11-01' AND pay_date <= '2025-11-30')
  )
ORDER BY pay_date DESC;

-- ============================================================================
-- STEP 2: Check if entries exist for this user in November runs
-- ============================================================================

-- First, get all November run IDs
WITH november_runs AS (
    SELECT id as run_id
    FROM hrpayroll_runs
    WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
      AND (
        (pay_period_end >= '2025-11-01' AND pay_period_end <= '2025-11-30')
        OR (pay_date >= '2025-11-01' AND pay_date <= '2025-11-30')
      )
)
SELECT 
    e.id as entry_id,
    e.user_id,
    e.business_id,
    e.payroll_run_id,
    e.net_pay,
    e.gross_pay,
    e.created_at,
    r.pay_period_start,
    r.pay_period_end,
    r.pay_date,
    r.status as run_status
FROM hrpayroll_entries e
INNER JOIN hrpayroll_runs r ON e.payroll_run_id = r.id
INNER JOIN november_runs nr ON r.id = nr.run_id
WHERE e.user_id = 'f3693c3b-7650-40b8-a93d-b0bac4c61d79'
ORDER BY r.pay_date DESC;

-- ============================================================================
-- STEP 3: Check ALL entries for this user (to see what IS showing)
-- ============================================================================

SELECT 
    e.id as entry_id,
    e.user_id,
    e.business_id,
    e.payroll_run_id,
    e.net_pay,
    e.gross_pay,
    e.created_at,
    r.pay_period_start,
    r.pay_period_end,
    r.pay_date,
    r.status as run_status
FROM hrpayroll_entries e
INNER JOIN hrpayroll_runs r ON e.payroll_run_id = r.id
WHERE e.user_id = 'f3693c3b-7650-40b8-a93d-b0bac4c61d79'
  AND e.business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
ORDER BY r.pay_date DESC
LIMIT 20;

-- ============================================================================
-- STEP 4: Check if there are ANY November entries in the database
-- (regardless of user/business)
-- ============================================================================

SELECT 
    e.id as entry_id,
    e.user_id,
    e.business_id,
    e.payroll_run_id,
    r.pay_period_start,
    r.pay_period_end,
    r.pay_date,
    r.status as run_status,
    u.email as user_email
FROM hrpayroll_entries e
INNER JOIN hrpayroll_runs r ON e.payroll_run_id = r.id
LEFT JOIN users u ON e.user_id = u.id
WHERE (
    (r.pay_period_end >= '2025-11-01' AND r.pay_period_end <= '2025-11-30')
    OR (r.pay_date >= '2025-11-01' AND r.pay_date <= '2025-11-30')
  )
ORDER BY r.pay_date DESC
LIMIT 20;

-- ============================================================================
-- STEP 5: Check RLS policies on hrpayroll_entries
-- ============================================================================

SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'hrpayroll_entries'
  AND cmd = 'SELECT'
ORDER BY policyname;

-- ============================================================================
-- STEP 6: Check RLS policies on hrpayroll_runs
-- ============================================================================

[
  {
    "schemaname": "public",
    "tablename": "hrpayroll_entries",
    "policyname": "hrpayroll_entries_viewing_token_select",
    "permissive": "PERMISSIVE",
    "roles": "{public}",
    "cmd": "SELECT",
    "qual": "(viewing_token IS NOT NULL)",
    "with_check": null
  }
]
-- ============================================================================
-- STEP 7: Test the exact query the portal uses (simulated)
-- ============================================================================

-- This simulates what the portal query does:
-- 1. Get entries for user_id
-- 2. Filter by business_id
-- 3. Join with hrpayroll_runs
-- 4. Order by pay_date

SELECT 
    e.*,
    r.id as run_id,
    r.pay_period_start,
    r.pay_period_end,
    r.pay_date,
    r.status as run_status,
    r.business_id as run_business_id
FROM hrpayroll_entries e
INNER JOIN hrpayroll_runs r ON e.payroll_run_id = r.id
WHERE e.user_id = 'f3693c3b-7650-40b8-a93d-b0bac4c61d79'
  AND e.business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
ORDER BY r.pay_date DESC NULLS LAST;

-- ============================================================================
-- STEP 8: Check for specific November dates mentioned (Nov 1, 8, 15)
-- ============================================================================

SELECT 
    r.id as run_id,
    r.business_id,
    r.pay_period_start,
    r.pay_period_end,
    r.pay_date,
    r.status,
    e.id as entry_id,
    e.user_id,
    e.business_id as entry_business_id
FROM hrpayroll_runs r
LEFT JOIN hrpayroll_entries e ON r.id = e.payroll_run_id AND e.user_id = 'f3693c3b-7650-40b8-a93d-b0bac4c61d79'
WHERE r.business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
  AND (
    r.pay_date IN ('2025-11-01', '2025-11-08', '2025-11-15')
    OR r.pay_period_end IN ('2025-11-01', '2025-11-08', '2025-11-15')
  )
ORDER BY r.pay_date DESC;



