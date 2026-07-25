-- Add all missing fields to hr_terminations table
-- This combines email fields and termination notice fields

-- Email fields
ALTER TABLE hr_terminations 
ADD COLUMN IF NOT EXISTS email_to TEXT,
ADD COLUMN IF NOT EXISTS email_cc TEXT;

-- Termination notice fields
ALTER TABLE hr_terminations 
ADD COLUMN IF NOT EXISTS manager_name TEXT,
ADD COLUMN IF NOT EXISTS manager_title TEXT,
ADD COLUMN IF NOT EXISTS notice_body TEXT,
ADD COLUMN IF NOT EXISTS subject_line TEXT,
ADD COLUMN IF NOT EXISTS employee_address TEXT;

-- Add index for email queries if needed
CREATE INDEX IF NOT EXISTS idx_hr_terminations_email_sent ON hr_terminations(email_sent);

