-- Add indexes to optimize common queries and reduce database load
-- This will improve query performance and reduce resource usage
-- If this times out, run add_critical_indexes_only.sql instead
-- Run indexes ONE AT A TIME if needed

-- Indexes for users table
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_personal_info_token ON users(personal_info_token) WHERE personal_info_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_business_id ON users(business_id) WHERE business_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_employment_status ON users(employment_status);
CREATE INDEX IF NOT EXISTS idx_users_termination_date ON users(termination_date) WHERE termination_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- Indexes for hr_contracts table
CREATE INDEX IF NOT EXISTS idx_hr_contracts_business_id ON hr_contracts(business_id);
CREATE INDEX IF NOT EXISTS idx_hr_contracts_employee_id ON hr_contracts(employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hr_contracts_employee_email ON hr_contracts(employee_email);
CREATE INDEX IF NOT EXISTS idx_hr_contracts_status ON hr_contracts(status);
CREATE INDEX IF NOT EXISTS idx_hr_contracts_personal_info_token ON hr_contracts(personal_info_token) WHERE personal_info_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hr_contracts_signing_token ON hr_contracts(signing_token);
CREATE INDEX IF NOT EXISTS idx_hr_contracts_created_at ON hr_contracts(created_at);
CREATE INDEX IF NOT EXISTS idx_hr_contracts_signed_at ON hr_contracts(signed_at) WHERE signed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hr_contracts_start_date ON hr_contracts(start_date);

-- Composite index for common contract queries
CREATE INDEX IF NOT EXISTS idx_hr_contracts_business_status ON hr_contracts(business_id, status);
CREATE INDEX IF NOT EXISTS idx_hr_contracts_employee_status ON hr_contracts(employee_id, status) WHERE employee_id IS NOT NULL;

-- Indexes for user_roles table
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_business_id ON user_roles(business_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_active ON user_roles(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_user_roles_user_business ON user_roles(user_id, business_id);

-- Indexes for business_users table
CREATE INDEX IF NOT EXISTS idx_business_users_user_id ON business_users(user_id);
CREATE INDEX IF NOT EXISTS idx_business_users_business_id ON business_users(business_id);
CREATE INDEX IF NOT EXISTS idx_business_users_user_business ON business_users(user_id, business_id);

-- Indexes for contract_sections table
CREATE INDEX IF NOT EXISTS idx_contract_sections_contract_id ON contract_sections(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_sections_section_order ON contract_sections(contract_id, section_order);

-- Indexes for payroll tables
CREATE INDEX IF NOT EXISTS idx_hrpayroll_runs_business_id ON hrpayroll_runs(business_id);
CREATE INDEX IF NOT EXISTS idx_hrpayroll_runs_status ON hrpayroll_runs(status);
CREATE INDEX IF NOT EXISTS idx_hrpayroll_runs_created_at ON hrpayroll_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_hrpayroll_entries_run_id ON hrpayroll_entries(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_hrpayroll_entries_user_id ON hrpayroll_entries(user_id);

-- Indexes for time tracking (if exists)
CREATE INDEX IF NOT EXISTS idx_time_entries_user_id ON time_entries(user_id) WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'time_entries');
CREATE INDEX IF NOT EXISTS idx_time_entries_business_id ON time_entries(business_id) WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'time_entries');
CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(entry_date) WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'time_entries');

-- Analyze tables after creating indexes (helps query planner)
ANALYZE users;
ANALYZE hr_contracts;
ANALYZE user_roles;
ANALYZE business_users;
ANALYZE contract_sections;
ANALYZE hrpayroll_runs;
ANALYZE hrpayroll_entries;

