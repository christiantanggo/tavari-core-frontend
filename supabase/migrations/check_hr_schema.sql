-- Diagnostic query to check what tables and columns exist
-- Run this first to see what we're working with

-- Check if certificate_files table exists
SELECT 
  'certificate_files table' as check_type,
  EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'certificate_files'
  ) as exists;

-- Check hr_contracts table columns
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'hr_contracts'
ORDER BY ordinal_position;

-- Check if storage_path column exists in hr_contracts
SELECT 
  'storage_path in hr_contracts' as check_type,
  EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'hr_contracts' 
    AND column_name = 'storage_path'
  ) as exists;

-- Check what certificate-related tables exist
SELECT 
  table_name
FROM information_schema.tables
WHERE table_schema = 'public' 
  AND (table_name LIKE '%certificate%' OR table_name LIKE '%cert%')
ORDER BY table_name;










