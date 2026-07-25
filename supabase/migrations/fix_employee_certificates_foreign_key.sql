-- Fix employee_certificates foreign key constraint
-- The constraint currently references tavari_employees.id but should reference users.id
-- This is because the application uses users.id as the employee_id

-- Step 1: Drop the existing foreign key constraint that references tavari_employees
ALTER TABLE employee_certificates 
DROP CONSTRAINT IF EXISTS fk_employee_certificates_employee;

-- Step 2: Add the correct foreign key constraint referencing users table
ALTER TABLE employee_certificates
ADD CONSTRAINT fk_employee_certificates_employee
FOREIGN KEY (employee_id) 
REFERENCES users(id) 
ON DELETE CASCADE;

