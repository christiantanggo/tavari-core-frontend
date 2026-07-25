-- Add Social Media AI Agent to module catalog
-- This makes it available in the module marketplace and sidebar navigation

INSERT INTO app_modules (module_key, module_name, description, icon, enabled_by_default, module_category) 
VALUES (
    'social_media', 
    'AI Social Media Agent', 
    'AI-powered social media automation for Instagram, Facebook, Twitter, and TikTok with automated content generation and posting',
    'FiShare2', 
    false, 
    'Marketing'
)
ON CONFLICT (module_key) DO UPDATE
SET 
    module_name = EXCLUDED.module_name,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    module_category = EXCLUDED.module_category;


