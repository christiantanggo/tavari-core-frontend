-- ============================================
-- TOSA Module Management System - Database Schema
-- ============================================
-- This schema supports pricing tiers, feature flags, subscription packages,
-- and business subscription management

-- ============================================
-- 1. Module Tiers Table
-- ============================================
-- Defines pricing tiers (Free, Starter, Professional, Enterprise) for modules
CREATE TABLE IF NOT EXISTS module_tiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tier_key TEXT NOT NULL UNIQUE, -- 'free', 'starter', 'professional', 'enterprise'
    tier_name TEXT NOT NULL, -- 'Free', 'Starter', 'Professional', 'Enterprise'
    description TEXT,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for tier lookups
CREATE INDEX IF NOT EXISTS idx_module_tiers_key ON module_tiers(tier_key);
CREATE INDEX IF NOT EXISTS idx_module_tiers_active ON module_tiers(is_active);

-- ============================================
-- 2. Module Tier Pricing Table
-- ============================================
-- Defines pricing for each module at each tier
CREATE TABLE IF NOT EXISTS module_tier_pricing (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_key TEXT NOT NULL REFERENCES app_modules(module_key) ON DELETE CASCADE,
    tier_key TEXT NOT NULL REFERENCES module_tiers(tier_key) ON DELETE CASCADE,
    price_monthly DECIMAL(10, 2) DEFAULT 0.00,
    price_yearly DECIMAL(10, 2) DEFAULT 0.00,
    setup_fee DECIMAL(10, 2) DEFAULT 0.00,
    currency TEXT DEFAULT 'CAD',
    is_available BOOLEAN DEFAULT true,
    features JSONB DEFAULT '{}'::jsonb, -- Feature flags for this tier
    usage_limits JSONB DEFAULT '{}'::jsonb, -- Usage limits (e.g., {"users": 10, "storage_gb": 5})
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(module_key, tier_key)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_module_tier_pricing_module ON module_tier_pricing(module_key);
CREATE INDEX IF NOT EXISTS idx_module_tier_pricing_tier ON module_tier_pricing(tier_key);
CREATE INDEX IF NOT EXISTS idx_module_tier_pricing_available ON module_tier_pricing(is_available);

-- ============================================
-- 3. Module Features Table
-- ============================================
-- Maps features to modules (for feature-level access control)
CREATE TABLE IF NOT EXISTS module_features (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_key TEXT NOT NULL REFERENCES app_modules(module_key) ON DELETE CASCADE,
    feature_key TEXT NOT NULL, -- e.g., 'music.upload', 'music.ads.manage'
    feature_name TEXT NOT NULL,
    feature_description TEXT,
    is_premium BOOLEAN DEFAULT false, -- Requires paid tier
    required_tier TEXT, -- Minimum tier required (null = available in all tiers)
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(module_key, feature_key)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_module_features_module ON module_features(module_key);
CREATE INDEX IF NOT EXISTS idx_module_features_tier ON module_features(required_tier);

-- ============================================
-- 4. Subscription Packages Table
-- ============================================
-- Defines bundled packages of modules (e.g., "Starter Package", "Professional Suite")
CREATE TABLE IF NOT EXISTS subscription_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_key TEXT NOT NULL UNIQUE, -- 'starter_package', 'professional_suite', etc.
    package_name TEXT NOT NULL,
    description TEXT,
    tier_key TEXT NOT NULL REFERENCES module_tiers(tier_key),
    price_monthly DECIMAL(10, 2) DEFAULT 0.00,
    price_yearly DECIMAL(10, 2) DEFAULT 0.00,
    setup_fee DECIMAL(10, 2) DEFAULT 0.00,
    currency TEXT DEFAULT 'CAD',
    included_modules JSONB DEFAULT '[]'::jsonb, -- Array of module_keys included
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_subscription_packages_key ON subscription_packages(package_key);
CREATE INDEX IF NOT EXISTS idx_subscription_packages_active ON subscription_packages(is_active);
CREATE INDEX IF NOT EXISTS idx_subscription_packages_tier ON subscription_packages(tier_key);

-- ============================================
-- 5. Business Subscriptions Table
-- ============================================
-- Tracks which businesses have which subscriptions (packages or individual modules)
CREATE TABLE IF NOT EXISTS business_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    subscription_type TEXT NOT NULL CHECK (subscription_type IN ('module', 'package')),
    subscription_key TEXT NOT NULL, -- module_key or package_key
    tier_key TEXT NOT NULL REFERENCES module_tiers(tier_key),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trial', 'expired', 'cancelled', 'pending')),
    billing_cycle TEXT DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'yearly')),
    price DECIMAL(10, 2) NOT NULL,
    currency TEXT DEFAULT 'CAD',
    started_at TIMESTAMPTZ DEFAULT now(),
    trial_ends_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    stripe_subscription_id TEXT, -- For Stripe integration
    auto_renew BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(business_id, subscription_type, subscription_key)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_business_subscriptions_business ON business_subscriptions(business_id);
CREATE INDEX IF NOT EXISTS idx_business_subscriptions_status ON business_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_business_subscriptions_type ON business_subscriptions(subscription_type, subscription_key);
CREATE INDEX IF NOT EXISTS idx_business_subscriptions_active ON business_subscriptions(business_id, status) WHERE status = 'active';

-- ============================================
-- 6. Enable RLS
-- ============================================
ALTER TABLE module_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_tier_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_subscriptions ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 7. RLS Policies (TOSA Admin Access Only)
-- ============================================
-- TOSA employees can manage everything
-- Regular users can only view their own business subscriptions

-- Module Tiers - TOSA only
CREATE POLICY "tosa_module_tiers_all"
ON module_tiers FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM tavari_employees te
        WHERE te.user_id = auth.uid() AND te.is_active = true
    )
);

-- Module Tier Pricing - TOSA only
CREATE POLICY "tosa_module_tier_pricing_all"
ON module_tier_pricing FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM tavari_employees te
        WHERE te.user_id = auth.uid() AND te.is_active = true
    )
);

-- Module Features - TOSA can manage, users can view
CREATE POLICY "tosa_module_features_all"
ON module_features FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM tavari_employees te
        WHERE te.user_id = auth.uid() AND te.is_active = true
    )
);

CREATE POLICY "users_module_features_select"
ON module_features FOR SELECT
USING (true); -- All authenticated users can view features

-- Subscription Packages - TOSA can manage, users can view
CREATE POLICY "tosa_subscription_packages_all"
ON subscription_packages FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM tavari_employees te
        WHERE te.user_id = auth.uid() AND te.is_active = true
    )
);

CREATE POLICY "users_subscription_packages_select"
ON subscription_packages FOR SELECT
USING (true); -- All authenticated users can view packages

-- Business Subscriptions - TOSA can manage all, users can view their own
CREATE POLICY "tosa_business_subscriptions_all"
ON business_subscriptions FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM tavari_employees te
        WHERE te.user_id = auth.uid() AND te.is_active = true
    )
);

CREATE POLICY "users_business_subscriptions_select"
ON business_subscriptions FOR SELECT
USING (
    business_id IN (
        SELECT business_id FROM user_roles
        WHERE user_id = auth.uid() AND active = true
    )
);

-- ============================================
-- 8. Seed Default Tiers
-- ============================================
INSERT INTO module_tiers (tier_key, tier_name, description, display_order) VALUES
    ('free', 'Free', 'Basic features with limited usage', 1),
    ('starter', 'Starter', 'Essential features for small businesses', 2),
    ('professional', 'Professional', 'Advanced features for growing businesses', 3),
    ('enterprise', 'Enterprise', 'Full feature set with priority support', 4)
ON CONFLICT (tier_key) DO NOTHING;

-- ============================================
-- 9. Helper Functions
-- ============================================

-- Function to get business subscription status
CREATE OR REPLACE FUNCTION get_business_subscription_status(business_uuid UUID, module_key_param TEXT)
RETURNS TABLE (
    has_access BOOLEAN,
    tier_key TEXT,
    status TEXT,
    subscription_type TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        CASE 
            WHEN bs.status = 'active' OR bs.status = 'trial' THEN true
            ELSE false
        END as has_access,
        bs.tier_key,
        bs.status,
        bs.subscription_type
    FROM business_subscriptions bs
    WHERE bs.business_id = business_uuid
        AND (
            (bs.subscription_type = 'module' AND bs.subscription_key = module_key_param)
            OR (bs.subscription_type = 'package' AND module_key_param = ANY(
                SELECT jsonb_array_elements_text(sp.included_modules)
                FROM subscription_packages sp
                WHERE sp.package_key = bs.subscription_key
            ))
        )
        AND bs.status IN ('active', 'trial')
    LIMIT 1;
END;
$$;

-- Function to check feature access
CREATE OR REPLACE FUNCTION check_feature_access(
    business_uuid UUID,
    feature_key_param TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    module_key_var TEXT;
    required_tier_var TEXT;
    business_tier_var TEXT;
BEGIN
    -- Get module key from feature
    SELECT mf.module_key, mf.required_tier INTO module_key_var, required_tier_var
    FROM module_features mf
    WHERE mf.feature_key = feature_key_param
    LIMIT 1;

    IF module_key_var IS NULL THEN
        RETURN false; -- Feature doesn't exist
    END IF;

    -- If no tier required, feature is available
    IF required_tier_var IS NULL THEN
        RETURN true;
    END IF;

    -- Get business's tier for this module
    SELECT bs.tier_key INTO business_tier_var
    FROM business_subscriptions bs
    WHERE bs.business_id = business_uuid
        AND (
            (bs.subscription_type = 'module' AND bs.subscription_key = module_key_var)
            OR (bs.subscription_type = 'package' AND module_key_var = ANY(
                SELECT jsonb_array_elements_text(sp.included_modules)
                FROM subscription_packages sp
                WHERE sp.package_key = bs.subscription_key
            ))
        )
        AND bs.status IN ('active', 'trial')
    LIMIT 1;

    IF business_tier_var IS NULL THEN
        RETURN false; -- No subscription
    END IF;

    -- Check if business tier meets requirement
    -- Tier order: free < starter < professional < enterprise
    RETURN CASE required_tier_var
        WHEN 'free' THEN true
        WHEN 'starter' THEN business_tier_var IN ('starter', 'professional', 'enterprise')
        WHEN 'professional' THEN business_tier_var IN ('professional', 'enterprise')
        WHEN 'enterprise' THEN business_tier_var = 'enterprise'
        ELSE false
    END;
END;
$$;

-- ============================================
-- 10. Update Triggers
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER module_tiers_updated_at
    BEFORE UPDATE ON module_tiers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER module_tier_pricing_updated_at
    BEFORE UPDATE ON module_tier_pricing
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER module_features_updated_at
    BEFORE UPDATE ON module_features
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER subscription_packages_updated_at
    BEFORE UPDATE ON subscription_packages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER business_subscriptions_updated_at
    BEFORE UPDATE ON business_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();



