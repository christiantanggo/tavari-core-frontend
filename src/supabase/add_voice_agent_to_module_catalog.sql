-- Add Voice Agent module to app_modules catalog

INSERT INTO app_modules (module_key, module_name, description, icon, enabled_by_default, module_category)
VALUES (
    'voice_agent',
    'Tavari Voice Agent',
    'AI-powered phone agent for answering calls, capturing leads, and scheduling appointments 24/7',
    'FiPhone',
    false,
    'Communications'
)
ON CONFLICT (module_key) DO UPDATE
SET 
    module_name = EXCLUDED.module_name,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    module_category = EXCLUDED.module_category;


