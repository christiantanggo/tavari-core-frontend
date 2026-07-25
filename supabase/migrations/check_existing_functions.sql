-- Check what functions exist related to personal_info_token
SELECT 
  r.routine_name,
  r.routine_type,
  r.data_type as return_type,
  string_agg(p.parameter_name || ' ' || p.data_type, ', ' ORDER BY p.ordinal_position) as parameters
FROM information_schema.routines r
LEFT JOIN information_schema.parameters p ON r.specific_name = p.specific_name
WHERE r.routine_schema = 'public'
  AND (r.routine_name LIKE '%personal_info%' OR r.routine_name LIKE '%user%token%')
GROUP BY r.routine_name, r.routine_type, r.data_type
ORDER BY r.routine_name;
