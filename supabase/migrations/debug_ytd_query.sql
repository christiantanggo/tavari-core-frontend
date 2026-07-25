-- Debug query to see what entries the YTD calculation should find
-- This matches the logic in calculateEmployeeYTD

-- Replace with your user_id
-- User ID: f3693c3b-7650-40b8-a93d-b0bac4c61d79
-- Business ID: cb982fca-cf7a-4f59-b9c7-55ca0364eddc

-- Step 1: Check what the query should return (from year start to 2025-12-26)
SELECT 
  e.id,
  e.user_id,
  r.pay_date,
  e.gross_pay,
  e.net_pay,
  e.federal_tax,
  e.regular_hours,
  e.total_hours,
  r.business_id
FROM hrpayroll_entries e
INNER JOIN hrpayroll_runs r ON e.payroll_run_id = r.id
WHERE e.user_id = 'f3693c3b-7650-40b8-a93d-b0bac4c61d79'::uuid
  AND r.business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'::uuid
  AND r.pay_date > '2025-01-01'  -- Year start (using .gt() like the code)
  AND r.pay_date <= '2025-12-26'  -- Target date (most recent 2025 payroll)
ORDER BY r.pay_date ASC;

-- Step 2: Check the sum (what YTD should be)
SELECT 
  COUNT(*) as entry_count,
  SUM(e.regular_hours) as total_regular_hours,
  SUM(e.total_hours) as total_hours,
  SUM(e.gross_pay) as total_gross_pay,
  SUM(e.net_pay) as total_net_pay,
  SUM(e.federal_tax) as total_federal_tax,
  SUM(e.vacation_pay) as total_vacation_pay,
  SUM(e.holiday_pay) as total_holiday_pay
FROM hrpayroll_entries e
INNER JOIN hrpayroll_runs r ON e.payroll_run_id = r.id
WHERE e.user_id = 'f3693c3b-7650-40b8-a93d-b0bac4c61d79'::uuid
  AND r.business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'::uuid
  AND r.pay_date > '2025-01-01'
  AND r.pay_date <= '2025-12-26';









