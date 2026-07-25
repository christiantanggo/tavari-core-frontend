-- Add only the most critical indexes - run one at a time if needed
-- These are the indexes that will have the biggest impact

-- Most critical: personal_info_token lookups
CREATE INDEX IF NOT EXISTS idx_users_personal_info_token ON users(personal_info_token) WHERE personal_info_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hr_contracts_personal_info_token ON hr_contracts(personal_info_token) WHERE personal_info_token IS NOT NULL;

-- Critical: email lookups (used everywhere)
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Critical: business_id lookups
CREATE INDEX IF NOT EXISTS idx_hr_contracts_business_id ON hr_contracts(business_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_business_id ON user_roles(business_id);

-- Critical: status filters
CREATE INDEX IF NOT EXISTS idx_hr_contracts_status ON hr_contracts(status);
CREATE INDEX IF NOT EXISTS idx_users_employment_status ON users(employment_status);












