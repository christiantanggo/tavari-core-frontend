-- Add email_to and email_cc columns to hr_terminations table
ALTER TABLE hr_terminations 
ADD COLUMN IF NOT EXISTS email_to TEXT,
ADD COLUMN IF NOT EXISTS email_cc TEXT;

-- Add index for email queries if needed
CREATE INDEX IF NOT EXISTS idx_hr_terminations_email_sent ON hr_terminations(email_sent);

