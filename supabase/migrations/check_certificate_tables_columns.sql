-- Check columns in certificate-related tables to find which one stores file paths

-- Check employee_certificates columns
SELECT 
  'employee_certificates' as table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'employee_certificates'
ORDER BY ordinal_position;

-- Check hr_certificates columns
SELECT 
  'hr_certificates' as table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'hr_certificates'
ORDER BY ordinal_position;

-- Check certificate_notification_log columns
SELECT 
  'certificate_notification_log' as table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'certificate_notification_log'
ORDER BY ordinal_position;










