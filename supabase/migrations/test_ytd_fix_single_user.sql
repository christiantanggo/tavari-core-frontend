-- Test YTD Fix - Reset YTD for Single User (Yourself)
-- Step 1: Find your user_id by email
-- Replace 'your-email@example.com' with your actual email address

SELECT 
  id as user_id,
  email,
  first_name,
  last_name,
  employee_number
FROM users
WHERE email = 'your-email@example.com';

-- Step 2: After you get your user_id, run this to see your current YTD data
-- Replace 'YOUR_USER_ID_HERE' with the user_id from Step 1
/*
SELECT 
  user_id,
  tax_year,
  regular_hours,
  overtime_hours,
  hours_worked,
  regular_income,
  overtime_income,
  gross_pay,
  net_pay,
  federal_tax,
  last_updated,
  last_payroll_run_id
FROM hrpayroll_ytd_data
WHERE user_id = 'YOUR_USER_ID_HERE'::uuid
  AND tax_year = EXTRACT(YEAR FROM CURRENT_DATE);
*/

-- Step 3: Reset your YTD data (forces recalculation from scratch)
-- Replace 'YOUR_USER_ID_HERE' with the user_id from Step 1
-- Uncomment and run:
/*
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
WHERE user_id = 'YOUR_USER_ID_HERE'::uuid
  AND tax_year = EXTRACT(YEAR FROM CURRENT_DATE);
*/

-- Step 4: Verify the reset worked (should show all zeros)
-- Replace 'YOUR_USER_ID_HERE' with the user_id from Step 1
/*
SELECT 
  user_id,
  tax_year,
  regular_hours,
  hours_worked,
  gross_pay,
  net_pay,
  last_updated
FROM hrpayroll_ytd_data
WHERE user_id = 'YOUR_USER_ID_HERE'::uuid
  AND tax_year = EXTRACT(YEAR FROM CURRENT_DATE);
*/

-- Step 5: Check your payroll entries (to verify what should be in YTD)
-- Replace 'YOUR_USER_ID_HERE' with the user_id from Step 1
/*
SELECT 
  e.id,
  e.payroll_run_id,
  r.pay_date,
  e.regular_hours,
  e.overtime_hours,
  e.total_hours,
  e.gross_pay,
  e.net_pay,
  e.federal_tax,
  e.created_at
FROM hrpayroll_entries e
LEFT JOIN hrpayroll_runs r ON e.payroll_run_id = r.id
WHERE e.user_id = 'YOUR_USER_ID_HERE'::uuid
  AND (r.pay_date >= DATE_TRUNC('year', CURRENT_DATE) OR r.pay_date IS NULL)
ORDER BY r.pay_date ASC, e.created_at ASC;
*/









