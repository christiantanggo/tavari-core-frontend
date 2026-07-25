-- Test script for create_employee_from_contract_rpc function
-- Run this in Supabase SQL Editor to verify everything works

-- ============================================================================
-- STEP 1: Verify function exists
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'create_employee_from_contract_rpc'
  ) THEN
    RAISE NOTICE '✅ Function create_employee_from_contract_rpc EXISTS';
  ELSE
    RAISE EXCEPTION '❌ Function create_employee_from_contract_rpc DOES NOT EXIST - Run migration first!';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Get a test business_id and run all tests
-- ============================================================================
DO $$
DECLARE
  test_business_id UUID;
  test_user_id UUID;
  updated_user_id UUID;
  test_email TEXT := 'test-employee-' || extract(epoch from now())::text || '@test.tavari.com';
  test_first_name TEXT := 'Test';
  test_last_name TEXT := 'Employee';
BEGIN
  -- Get first business
  SELECT id INTO test_business_id FROM businesses LIMIT 1;
  
  IF test_business_id IS NULL THEN
    RAISE EXCEPTION '❌ No businesses found in database - cannot run test';
  END IF;
  
  RAISE NOTICE '📋 Test Business ID: %', test_business_id;
  RAISE NOTICE '📧 Test Email: %', test_email;
  
  -- ============================================================================
  -- STEP 3: Test creating a new employee
  -- ============================================================================
  RAISE NOTICE '🧪 Testing employee creation...';
  
  SELECT create_employee_from_contract_rpc(
    p_business_id := test_business_id,
    p_employee_email := test_email,
    p_employee_first_name := test_first_name,
    p_employee_last_name := test_last_name,
    p_employee_address := '123 Test St',
    p_position_title := 'Test Position',
    p_phone := '555-1234',
    p_hire_date := CURRENT_DATE,
    p_employment_status := 'active',
    p_wage := 20.00,
    p_vacation_percent := 4.0,
    p_department := 'Testing'
  ) INTO test_user_id;
  
  RAISE NOTICE '✅ Employee created with ID: %', test_user_id;
  
  -- ============================================================================
  -- STEP 4: Verify user_roles entry exists
  -- ============================================================================
  IF EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = test_user_id
    AND business_id = test_business_id
    AND role = 'employee'
    AND active = true
  ) THEN
    RAISE NOTICE '✅ user_roles entry EXISTS';
  ELSE
    RAISE EXCEPTION '❌ user_roles entry MISSING!';
  END IF;
  
  -- ============================================================================
  -- STEP 5: Verify business_users entry exists (CRITICAL FOR PORTAL ACCESS)
  -- ============================================================================
  IF EXISTS (
    SELECT 1 FROM business_users
    WHERE user_id = test_user_id
    AND business_id = test_business_id
    AND role = 'employee'
  ) THEN
    RAISE NOTICE '✅ business_users entry EXISTS (Portal access will work!)';
  ELSE
    RAISE EXCEPTION '❌ business_users entry MISSING! Portal access will FAIL!';
  END IF;
  
  -- ============================================================================
  -- STEP 6: Test updating existing employee (should not create duplicates)
  -- ============================================================================
  RAISE NOTICE '🧪 Testing update of existing employee...';
  
  SELECT create_employee_from_contract_rpc(
    p_business_id := test_business_id,
    p_employee_email := test_email,
    p_employee_first_name := 'Updated',
    p_employee_last_name := 'Name',
    p_position_title := 'Updated Position'
  ) INTO updated_user_id;
  
  IF updated_user_id = test_user_id THEN
    RAISE NOTICE '✅ Update test passed - same user ID returned';
  ELSE
    RAISE EXCEPTION '❌ Update test failed - different user ID returned!';
  END IF;
  
  -- Verify no duplicate entries
  IF (SELECT COUNT(*) FROM user_roles WHERE user_id = test_user_id AND business_id = test_business_id) = 1 THEN
    RAISE NOTICE '✅ No duplicate user_roles entries';
  ELSE
    RAISE EXCEPTION '❌ Duplicate user_roles entries found!';
  END IF;
  
  IF (SELECT COUNT(*) FROM business_users WHERE user_id = test_user_id AND business_id = test_business_id) = 1 THEN
    RAISE NOTICE '✅ No duplicate business_users entries';
  ELSE
    RAISE EXCEPTION '❌ Duplicate business_users entries found!';
  END IF;
  
  -- ============================================================================
  -- STEP 7: Cleanup test data (optional - comment out if you want to keep it)
  -- ============================================================================
  -- Uncomment to clean up test data:
  /*
  DELETE FROM business_users WHERE user_id = test_user_id;
  DELETE FROM user_roles WHERE user_id = test_user_id;
  DELETE FROM users WHERE id = test_user_id;
  RAISE NOTICE '🧹 Test data cleaned up';
  */
  
  RAISE NOTICE '';
  RAISE NOTICE '🎉 ALL TESTS PASSED! Function is working correctly.';
  RAISE NOTICE '📝 Test user ID: % (not cleaned up - you can delete manually if needed)', test_user_id;
  
END $$;

-- ============================================================================
-- STEP 8: Display summary
-- ============================================================================
SELECT 
  'Test Summary' as status,
  COUNT(*) FILTER (WHERE proname = 'create_employee_from_contract_rpc') as function_exists,
  (SELECT COUNT(*) FROM users WHERE email LIKE 'test-employee-%@test.tavari.com') as test_users_created
FROM pg_proc;

