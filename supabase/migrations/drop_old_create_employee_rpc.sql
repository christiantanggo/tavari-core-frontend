-- Drop the old version of create_employee_from_contract_rpc that doesn't have p_user_id
-- This ensures only the correct version (with p_user_id) exists

DROP FUNCTION IF EXISTS create_employee_from_contract_rpc(
  UUID,  -- p_business_id
  TEXT,  -- p_employee_email
  TEXT,  -- p_employee_first_name
  TEXT,  -- p_employee_last_name
  TEXT,  -- p_employee_address
  TEXT,  -- p_position_title
  TEXT,  -- p_phone
  DATE,  -- p_hire_date
  TEXT,  -- p_employment_status
  NUMERIC,  -- p_wage
  NUMERIC,  -- p_vacation_percent
  TEXT   -- p_department
  -- NOTE: This version does NOT have p_user_id
);

-- Verify only the correct version exists now
SELECT 
  'After cleanup' as check_type,
  pg_get_function_arguments(p.oid) as function_signature,
  CASE 
    WHEN pg_get_function_arguments(p.oid) LIKE '%p_user_id%' 
    THEN '✅ Correct version (has p_user_id)'
    ELSE '❌ Wrong version (missing p_user_id)'
  END as status
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'create_employee_from_contract_rpc';

-- Reload PostgREST schema
NOTIFY pgrst, 'reload schema';








