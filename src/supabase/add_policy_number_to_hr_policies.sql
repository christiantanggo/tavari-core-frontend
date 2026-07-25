-- Add policy_number column to hr_policies table
-- This column stores the policy number in format: [type_number].[sequence] e.g., "1.01", "4.03"

ALTER TABLE hr_policies 
ADD COLUMN IF NOT EXISTS policy_number TEXT;

-- Create index for policy_number to improve query performance
CREATE INDEX IF NOT EXISTS idx_hr_policies_policy_number ON hr_policies(policy_number);

-- Create index for policy_type and business_id combination (used for generating policy numbers)
CREATE INDEX IF NOT EXISTS idx_hr_policies_type_business ON hr_policies(business_id, policy_type);

-- Add comment to column
COMMENT ON COLUMN hr_policies.policy_number IS 'Policy number in format [type_number].[sequence] e.g., "1.01", "4.03"';



