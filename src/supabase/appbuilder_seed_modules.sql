-- Step 20: Seed app_modules table with Tavari modules
-- NOTE: This step is ALREADY COMPLETED in Step 2 (appbuilder_create_modules_table.sql)
-- The modules are seeded at the end of the table creation file.
-- 
-- This file is kept for reference only. If you need to re-seed or add more modules,
-- you can use the INSERT statement below (uncommented):

-- INSERT INTO app_modules (module_key, module_name, description, icon, enabled_by_default, module_category) VALUES
--     ('mail', 'Email', 'Email campaigns, contacts, and marketing automation', 'FiMail', false, 'Marketing'),
--     ('music', 'Music & Digital Signage', 'Music playlists, ads, and digital signage', 'FiMusic', false, 'Entertainment'),
--     ('hr', 'HR & Payroll', 'HR contracts, payroll runs, and employee management', 'FiUsers', false, 'Operations'),
--     ('pos', 'POS Lite', 'Point of sale, sales, and inventory management', 'FiShoppingCart', false, 'Sales'),
--     ('recipe_builder', 'Order Guide', 'Recipe builder, suppliers, and order management', 'FiPackage', false, 'Operations'),
--     ('loyalty', 'Loyalty', 'Loyalty accounts and transactions', 'FiStar', false, 'Marketing'),
--     ('scheduling', 'Scheduling', 'Employee scheduling, shifts, and time clock', 'FiCalendar', false, 'Operations')
-- ON CONFLICT (module_key) DO NOTHING;

-- Step 20 is complete - modules were already seeded in Step 2
SELECT 'Step 20: Modules already seeded in Step 2' AS status;

