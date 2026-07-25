-- Payroll journal posting: default GL accounts for salary, employer CPP/EI, payroll liability, bank.

ALTER TABLE accounting_business_config
  ADD COLUMN IF NOT EXISTS salary_expense_account_erpnext TEXT,
  ADD COLUMN IF NOT EXISTS employer_cpp_expense_account_erpnext TEXT,
  ADD COLUMN IF NOT EXISTS employer_ei_expense_account_erpnext TEXT,
  ADD COLUMN IF NOT EXISTS payroll_liability_account_erpnext TEXT,
  ADD COLUMN IF NOT EXISTS payroll_bank_account_erpnext TEXT;

COMMENT ON COLUMN accounting_business_config.salary_expense_account_erpnext IS 'ERPNext account for salary/wages expense (payroll journal).';
COMMENT ON COLUMN accounting_business_config.payroll_liability_account_erpnext IS 'ERPNext account for payroll deductions payable (CRA remittance).';
COMMENT ON COLUMN accounting_business_config.payroll_bank_account_erpnext IS 'ERPNext bank account for net pay.';
