-- Test YTD Fix - Christian Fournier
-- User ID: f3693c3b-7650-40b8-a93d-b0bac4c61d79

-- Step 1: Check current YTD data (BEFORE reset)
-- If this returns no rows, it means YTD hasn't been stored yet (which is fine - it will calculate from scratch)
SELECT 
  user_id,
  tax_year,
  regular_hours,
  overtime_hours,
  lieu_hours,
  stat_hours,
  holiday_hours,
  hours_worked,
  regular_income,
  overtime_income,
  lieu_income,
  vacation_pay,
  shift_premiums,
  stat_earnings,
  holiday_earnings,
  bonus,
  gross_pay,
  net_pay,
  federal_tax,
  provincial_tax,
  cpp_deduction,
  ei_deduction,
  additional_tax,
  last_updated,
  last_payroll_run_id
FROM hrpayroll_ytd_data
WHERE user_id = 'f3693c3b-7650-40b8-a93d-b0bac4c61d79'::uuid
  AND tax_year = EXTRACT(YEAR FROM CURRENT_DATE);

-- If Step 1 returned no rows, that's actually GOOD - it means YTD will calculate from scratch automatically
-- Skip to Step 2 to check your payroll entries

-- Step 2: Check your payroll entries (to verify what should be in YTD)
SELECT 
  e.id,
  e.payroll_run_id,
  r.pay_date,
  e.regular_hours,
  e.overtime_hours,
  e.lieu_hours,
  e.total_hours,
  e.gross_pay,
  e.net_pay,
  e.federal_tax,
  e.vacation_pay,
  e.holiday_pay,
  e.created_at
FROM hrpayroll_entries e
LEFT JOIN hrpayroll_runs r ON e.payroll_run_id = r.id
WHERE e.user_id = 'f3693c3b-7650-40b8-a93d-b0bac4c61d79'::uuid
  AND (r.pay_date >= DATE_TRUNC('year', CURRENT_DATE) OR r.pay_date IS NULL)
ORDER BY r.pay_date ASC, e.created_at ASC;

-- Step 3: Calculate expected totals (sum of all entries)
SELECT 
  COUNT(*) as total_entries,
  SUM(e.regular_hours) as total_regular_hours,
  SUM(e.overtime_hours) as total_overtime_hours,
  SUM(e.lieu_hours) as total_lieu_hours,
  SUM(e.total_hours) as total_hours,
  SUM(e.gross_pay) as total_gross_pay,
  SUM(e.net_pay) as total_net_pay,
  SUM(e.federal_tax) as total_federal_tax,
  SUM(e.vacation_pay) as total_vacation_pay,
  SUM(e.holiday_pay) as total_holiday_pay
FROM hrpayroll_entries e
LEFT JOIN hrpayroll_runs r ON e.payroll_run_id = r.id
WHERE e.user_id = 'f3693c3b-7650-40b8-a93d-b0bac4c61d79'::uuid
  AND (r.pay_date >= DATE_TRUNC('year', CURRENT_DATE) OR r.pay_date IS NULL);

-- Step 4: RESET your YTD data (run this to reset)
UPDATE hrpayroll_ytd_data
SET 
  regular_hours = 0,
  overtime_hours = 0,
  lieu_hours = 0,
  stat_hours = 0,
  holiday_hours = 0,
  hours_worked = 0,
  regular_income = 0,
  overtime_income = 0,
  lieu_income = 0,
  vacation_pay = 0,
  shift_premiums = 0,
  stat_earnings = 0,
  holiday_earnings = 0,
  bonus = 0,
  federal_tax = 0,
  provincial_tax = 0,
  cpp_deduction = 0,
  ei_deduction = 0,
  additional_tax = 0,
  gross_pay = 0,
  net_pay = 0,
  last_updated = DATE_TRUNC('year', CURRENT_DATE)::timestamp,
  updated_at = NOW()
WHERE user_id = 'f3693c3b-7650-40b8-a93d-b0bac4c61d79'::uuid
  AND tax_year = EXTRACT(YEAR FROM CURRENT_DATE);

-- Step 5: Verify reset worked (should show all zeros)
SELECT 
  user_id,
  tax_year,
  regular_hours,
  hours_worked,
  gross_pay,
  net_pay,
  federal_tax,
  last_updated
FROM hrpayroll_ytd_data
WHERE user_id = 'f3693c3b-7650-40b8-a93d-b0bac4c61d79'::uuid
  AND tax_year = EXTRACT(YEAR FROM CURRENT_DATE);

-- After reset:
-- 1. Go to HR → Payroll → Pay Statements
-- 2. View one of your pay statements
-- 3. The YTD should recalculate automatically
-- 4. Compare YTD values to the totals from Step 3

