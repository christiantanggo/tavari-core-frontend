-- Add missing modules to app_modules catalog
-- These modules should be available in the module marketplace

INSERT INTO app_modules (module_key, module_name, description, icon, enabled_by_default, module_category) VALUES
    ('dining', 'Tavari Dining', 'Table management, floor plans, reservations, and dining orders', 'FiShoppingBag', false, 'Operations'),
    ('bookings', 'Tavari Bookings', 'Event bookings, party packages, and scheduling', 'FiCalendar', false, 'Operations'),
    ('liquor', 'Tavari Liquor Management', 'Liquor inventory, compliance, and management', 'FiPackage', false, 'Operations'),
    ('recipe_builder', 'Tavari Recipe Manager', 'Recipe builder, suppliers, and order management', 'FiPackage', false, 'Operations'),
    ('inbox', 'Tavari Inbox', 'Email inbox management, domains, and mailboxes', 'FiInbox', false, 'Communication'),
    ('mail', 'Tavari Email Marketing', 'Email campaigns, contacts, and marketing automation', 'FiMail', false, 'Marketing'),
    ('appbuilder', 'Tavari App Builder', 'Create custom white-label iOS/Android apps with your branding', 'FiSmartphone', false, 'Platform'),
    ('waivers', 'Tavari Waivers', 'Digital waivers, templates, and compliance management', 'FiFileText', false, 'Compliance')
ON CONFLICT (module_key) DO UPDATE SET
    module_name = EXCLUDED.module_name,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    module_category = EXCLUDED.module_category;



