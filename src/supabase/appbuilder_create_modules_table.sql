-- Step 2: Create app_modules table
-- Global catalog of available modules (Email, Music, HR, POS, etc.)

CREATE TABLE IF NOT EXISTS app_modules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    module_key text NOT NULL UNIQUE,
    module_name text NOT NULL,
    description text,
    icon text,
    enabled_by_default boolean DEFAULT false,
    module_category text,
    created_at timestamptz DEFAULT now()
);

-- Create index for module_key lookups
CREATE INDEX IF NOT EXISTS idx_app_modules_module_key 
    ON app_modules(module_key);

-- Create index for category filtering
CREATE INDEX IF NOT EXISTS idx_app_modules_category 
    ON app_modules(module_category);

-- Enable RLS (policies will be created in Step 49)
ALTER TABLE app_modules ENABLE ROW LEVEL SECURITY;

-- Seed with Tavari modules
INSERT INTO app_modules (module_key, module_name, description, icon, enabled_by_default, module_category) VALUES
    ('mail', 'Tavari Email Marketing', 'Email campaigns, contacts, and marketing automation', 'FiMail', false, 'Marketing'),
    ('music', 'Tavari Music', 'Music playlists, scheduling, ad management, and revenue sharing', 'FiMusic', false, 'Entertainment'),
    ('digital_signage', 'Digital Signage', 'Screen management, content scheduling, dynamic ads, and multi-zone displays', 'FiMonitor', false, 'Entertainment'),
    ('hr', 'Tavari HR', 'HR contracts, payroll runs, and employee management', 'FiUsers', false, 'Operations'),
    ('pos', 'Tavari POS', 'Point of sale, sales, and inventory management', 'FiShoppingCart', false, 'Sales'),
    ('recipe_builder', 'Tavari Recipe Manager', 'Recipe builder, suppliers, and order management', 'FiPackage', false, 'Operations'),
    ('loyalty', 'Tavari Loyalty', 'Loyalty accounts and transactions', 'FiStar', false, 'Marketing'),
    ('scheduling', 'Tavari Scheduling', 'Employee scheduling, shifts, and time clock', 'FiCalendar', false, 'Operations'),
    ('dining', 'Tavari Dining', 'Table management, floor plans, reservations, and dining orders', 'FiShoppingBag', false, 'Operations'),
    ('bookings', 'Tavari Bookings', 'Event bookings, party packages, and scheduling', 'FiCalendar', false, 'Operations'),
    ('liquor', 'Tavari Liquor Management', 'Liquor inventory, compliance, and management', 'FiPackage', false, 'Operations'),
    ('inbox', 'Tavari Inbox', 'Email inbox management, domains, and mailboxes', 'FiInbox', false, 'Communication'),
    ('appbuilder', 'Tavari App Builder', 'Create custom white-label iOS/Android apps with your branding', 'FiSmartphone', false, 'Platform'),
    ('waivers', 'Tavari Waivers', 'Digital waivers, templates, and compliance management', 'FiFileText', false, 'Compliance'),
    ('voice_agent', 'AI Voice Agent', 'AI voice agent using VAPI for automated call handling', 'FiPhone', false, 'Communication'),
    ('custom_voice_agent', 'Custom AI Voice Agent', 'Custom AI voice agent using Telnyx + OpenAI Realtime (no VAPI)', 'FiPhoneCall', false, 'Communication')
ON CONFLICT (module_key) DO UPDATE SET
    module_name = EXCLUDED.module_name,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    module_category = EXCLUDED.module_category;




