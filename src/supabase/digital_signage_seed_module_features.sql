-- Seed module features for digital signage
-- Pattern: Matches existing module_features structure

-- Insert module features for digital_signage module
INSERT INTO module_features (module_key, feature_key, feature_name, feature_description, required_tier, is_premium)
VALUES
    -- Basic tier features
    ('digital_signage', 'digital_signage.dashboard.view', 'View Dashboard', 'View digital signage dashboard', NULL, false),
    ('digital_signage', 'digital_signage.screens.view', 'View Screens', 'View registered screens', NULL, false),
    ('digital_signage', 'digital_signage.screens.edit', 'Manage Screens', 'Register, edit, and delete screens', NULL, false),
    ('digital_signage', 'digital_signage.content.view', 'View Content', 'View content library', NULL, false),
    ('digital_signage', 'digital_signage.content.edit', 'Manage Content', 'Upload, edit, and delete content', NULL, false),
    ('digital_signage', 'digital_signage.schedules.view', 'View Schedules', 'View content schedules', NULL, false),
    ('digital_signage', 'digital_signage.schedules.edit', 'Manage Schedules', 'Create, edit, and delete schedules', NULL, false),
    
    -- Professional tier features
    ('digital_signage', 'digital_signage.zones.view', 'View Zones', 'View multi-zone layouts', 'professional', false),
    ('digital_signage', 'digital_signage.zones.edit', 'Manage Zones', 'Create and manage zones', 'professional', false),
    ('digital_signage', 'digital_signage.ads.view', 'View Ads', 'View ad campaigns', 'professional', false),
    ('digital_signage', 'digital_signage.ads.edit', 'Manage Ads', 'Create and manage ads', 'professional', false),
    ('digital_signage', 'digital_signage.analytics.view', 'View Analytics', 'View playback analytics', 'professional', false),
    
    -- Enterprise tier features
    ('digital_signage', 'digital_signage.templates.view', 'View Templates', 'View content templates', 'enterprise', false),
    ('digital_signage', 'digital_signage.templates.edit', 'Manage Templates', 'Create and manage templates', 'enterprise', false),
    ('digital_signage', 'digital_signage.settings.edit', 'Manage Settings', 'Edit global settings', 'enterprise', false),
    ('digital_signage', 'digital_signage.integrations', 'Integrations', 'Access API integrations', 'enterprise', false)
ON CONFLICT (module_key, feature_key) DO NOTHING;

