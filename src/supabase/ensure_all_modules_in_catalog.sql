-- Ensure all Tavari modules are in the app_modules catalog
-- This script will add any missing modules and update existing ones

INSERT INTO app_modules (module_key, module_name, description, icon, enabled_by_default, module_category) VALUES
    -- Core modules
    ('pos', 'Tavari POS', 'Point of sale, sales, and inventory management', 'FiBarChart2', false, 'Sales'),
    ('dining', 'Tavari Dining', 'Table management, floor plans, reservations, and dining orders', 'FiShoppingBag', false, 'Operations'),
    ('inbox', 'Tavari Inbox', 'Email inbox management, domains, and mailboxes', 'FiInbox', false, 'Communication'),
    ('waivers', 'Tavari Waivers', 'Digital waivers, templates, and compliance management', 'FiFileText', false, 'Compliance'),
    ('bookings', 'Tavari Bookings', 'Event bookings, party packages, and scheduling', 'FiCalendar', false, 'Operations'),
    ('scheduling', 'Tavari Scheduling', 'Employee scheduling, shifts, and time clock', 'FiCalendar', false, 'Operations'),
    ('hr', 'Tavari HR', 'HR contracts, payroll runs, and employee management', 'FiUsers', false, 'Operations'),
    ('mail', 'Tavari Email Marketing', 'Email campaigns, contacts, and marketing automation', 'FiMail', false, 'Marketing'),
    ('appbuilder', 'Tavari App Builder', 'Create custom white-label iOS/Android apps with your branding', 'FiSmartphone', false, 'Platform'),
    ('music', 'Tavari Music', 'Music playlists, scheduling, ad management, and revenue sharing', 'FiMusic', false, 'Entertainment'),
    ('recipe_builder', 'Tavari Recipe Manager', 'Recipe builder, suppliers, and order management', 'FiPackage', false, 'Operations'),
    ('liquor', 'Tavari Liquor Management', 'Liquor inventory, compliance, and management', 'FiPackage', false, 'Operations'),
    ('digital_signage', 'Tavari Digital Signage', 'Screen management, content scheduling, dynamic ads, and multi-zone displays', 'FiMonitor', false, 'Entertainment'),
    ('loyalty', 'Tavari Loyalty', 'Loyalty accounts and transactions', 'FiStar', false, 'Marketing'),
    ('vending', 'Tavari Vending', 'Cloud vending devices, kiosk links, optional catalog mapping (standalone add-on)', 'FiCpu', false, 'Sales'),
    ('power_bank', 'Power Bank', 'Shared charging cabinets: ChargeNow API, shops, pricing, cabinet ops, ads & webhooks', 'FiZap', false, 'Operations'),
    ('reminders', 'Tavari Reminder', 'Schedule employee email and portal reminders with complete and snooze actions', 'FiBell', false, 'Operations'),
    ('forms', 'Tavari Forms', 'Operational checklists and compliance forms (temperature logs, inspections). Separate from waivers.', 'FiClipboard', false, 'Compliance'),
    ('tasks', 'Tavari Task Manager', 'Prioritized staff tasks, recurring checks, kiosk completion, and training workflows', 'FiCheckSquare', false, 'Operations'),
    ('funding', 'Tavari Funding', 'Business plans, loan and grant applications, scenarios, collaborators, and Canadian funding program alerts', 'FiDollarSign', false, 'Finance'),
    ('invoices', 'Tavari Invoices', 'Send invoices, collect online payments, and build tax summary invoices', 'FiFileText', false, 'Sales')
ON CONFLICT (module_key) DO UPDATE SET
    module_name = EXCLUDED.module_name,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    module_category = EXCLUDED.module_category;

-- Verify all modules are present
SELECT module_key, module_name, module_category 
FROM app_modules 
ORDER BY module_name;

