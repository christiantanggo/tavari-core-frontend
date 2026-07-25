-- Step 3: Modify existing business_module_usage table
-- Table already exists with: id, business_id, module_name, usage_count, last_used
-- Adding new columns for AppBuilder functionality

-- Add module_key column (for linking to app_modules catalog)
ALTER TABLE business_module_usage 
    ADD COLUMN IF NOT EXISTS module_key text;

-- Add enabled column (to enable/disable modules per business)
ALTER TABLE business_module_usage 
    ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT false;

-- Add trial_enabled column (for trial tracking)
ALTER TABLE business_module_usage 
    ADD COLUMN IF NOT EXISTS trial_enabled boolean DEFAULT false;

-- Add trial_expires_at column (trial expiration date)
ALTER TABLE business_module_usage 
    ADD COLUMN IF NOT EXISTS trial_expires_at timestamptz;

-- Add created_at column (tracking when record was created)
ALTER TABLE business_module_usage 
    ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Add updated_at column (tracking when record was last updated)
ALTER TABLE business_module_usage 
    ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Verify foreign key exists (add if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'business_module_usage_business_id_fkey'
    ) THEN
        ALTER TABLE business_module_usage
            ADD CONSTRAINT business_module_usage_business_id_fkey
            FOREIGN KEY (business_id)
            REFERENCES businesses(id)
            ON DELETE CASCADE;
    END IF;
END $$;

-- Add unique constraint (business_id, module_key) - one enabled module per business
-- Drop existing constraint if it exists, then add new one
ALTER TABLE business_module_usage 
    DROP CONSTRAINT IF EXISTS business_module_usage_business_module_key_unique;

ALTER TABLE business_module_usage 
    ADD CONSTRAINT business_module_usage_business_module_key_unique
    UNIQUE (business_id, module_key);

-- Create index for enabled modules lookup
CREATE INDEX IF NOT EXISTS idx_business_module_usage_business_enabled 
    ON business_module_usage(business_id, enabled) 
    WHERE enabled = true;

-- Create index for module_key lookups
CREATE INDEX IF NOT EXISTS idx_business_module_usage_module_key 
    ON business_module_usage(module_key);

-- Create trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_business_module_usage_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS business_module_usage_updated_at ON business_module_usage;

CREATE TRIGGER business_module_usage_updated_at
    BEFORE UPDATE ON business_module_usage
    FOR EACH ROW
    EXECUTE FUNCTION update_business_module_usage_updated_at();

-- Note: RLS policies already exist (see Step 37)
-- RLS uses tavari_employees table for employee access




