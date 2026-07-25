-- Fix missing business_users entry for user
-- Run this AFTER running find_actual_user.sql to get the correct user ID
-- Replace the UUIDs below with the actual values from find_actual_user.sql results

DO $$
DECLARE
  target_user_id UUID := 'REPLACE_WITH_ACTUAL_USER_ID';  -- Get this from find_actual_user.sql
  target_business_id UUID := 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';  -- Your business ID
BEGIN
  -- Verify user exists first
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'User with ID % does not exist. Run find_actual_user.sql first to get the correct user ID.', target_user_id;
  END IF;
  
  RAISE NOTICE 'User ID: %', target_user_id;
  RAISE NOTICE 'Business ID: %', target_business_id;
  
  -- Check existing business_users
  IF EXISTS (SELECT 1 FROM public.business_users WHERE user_id = target_user_id AND business_id = target_business_id) THEN
    RAISE NOTICE 'business_users entry already exists';
  ELSE
    RAISE NOTICE 'Creating business_users entry...';
    INSERT INTO public.business_users (user_id, business_id, role)
    VALUES (target_user_id, target_business_id, 'employee');
    RAISE NOTICE 'business_users entry created';
  END IF;
  
  -- Check existing user_roles
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = target_user_id AND business_id = target_business_id) THEN
    RAISE NOTICE 'user_roles entry already exists';
  ELSE
    RAISE NOTICE 'Creating user_roles entry...';
    INSERT INTO public.user_roles (user_id, business_id, role, active)
    VALUES (target_user_id, target_business_id, 'employee', true);
    RAISE NOTICE 'user_roles entry created';
  END IF;
END $$;

-- Verify the entries exist (replace user_id in WHERE clause)
SELECT 
  u.id as user_id,
  u.email,
  bu.business_id,
  bu.role as business_role,
  ur.role as user_role,
  ur.active
FROM public.users u
LEFT JOIN public.business_users bu ON u.id = bu.user_id AND bu.business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
LEFT JOIN public.user_roles ur ON u.id = ur.user_id AND ur.business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
WHERE u.id = 'REPLACE_WITH_ACTUAL_USER_ID';  -- Replace with actual user ID

