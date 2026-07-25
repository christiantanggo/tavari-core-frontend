-- Add missing fields to hr_terminations table for storing termination notice details
ALTER TABLE hr_terminations 
ADD COLUMN IF NOT EXISTS manager_name TEXT,
ADD COLUMN IF NOT EXISTS manager_title TEXT,
ADD COLUMN IF NOT EXISTS notice_body TEXT,
ADD COLUMN IF NOT EXISTS subject_line TEXT,
ADD COLUMN IF NOT EXISTS employee_address TEXT;

