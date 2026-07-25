-- Fix YTD Calculation - Reset YTD Data for Recalculation
-- This script resets YTD data so it can be recalculated from scratch using the fixed logic
-- Run this if you're experiencing double counting or missing YTD data issues

-- Option 1: Reset YTD for ALL employees (for current year)
-- This will force recalculation from scratch for everyone
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
  last_updated = DATE_TRUNC('year', CURRENT_DATE)::timestamp, -- Reset to year start
  updated_at = NOW()
WHERE tax_year = EXTRACT(YEAR FROM CURRENT_DATE);

-- Option 2: Reset YTD for a specific employee (replace USER_ID_HERE with actual user ID)
-- Uncomment and use this if you only want to reset specific employees:
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
WHERE user_id = 'USER_ID_HERE'::uuid
  AND tax_year = EXTRACT(YEAR FROM CURRENT_DATE);
*/

-- Option 3: Delete YTD records entirely (forces complete recalculation)
-- Uncomment if you want to delete instead of reset to zeros:
/*
DELETE FROM hrpayroll_ytd_data
WHERE tax_year = EXTRACT(YEAR FROM CURRENT_DATE);
*/

-- After running this script:
-- 1. The next time YTD is calculated (when viewing pay statements or running payroll),
--    it will recalculate from scratch using the fixed logic
-- 2. The calculation will use all payroll entries from year start, not stored YTD as base
-- 3. Future payroll runs will correctly update YTD using the fixed date logic









