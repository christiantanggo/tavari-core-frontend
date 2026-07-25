-- Step 10: Create app_webhooks table
-- Table for managing webhooks for app events

CREATE TABLE IF NOT EXISTS app_webhooks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    webhook_url text NOT NULL,
    event_types text[] NOT NULL,
    secret text,
    active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    
    CONSTRAINT app_webhooks_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE
);

-- Create index for business_id lookups
CREATE INDEX IF NOT EXISTS idx_app_webhooks_business_id 
    ON app_webhooks(business_id);

-- Create index for active webhooks
CREATE INDEX IF NOT EXISTS idx_app_webhooks_active 
    ON app_webhooks(business_id, active) 
    WHERE active = true;

-- Create trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_app_webhooks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER app_webhooks_updated_at
    BEFORE UPDATE ON app_webhooks
    FOR EACH ROW
    EXECUTE FUNCTION update_app_webhooks_updated_at();

-- Enable RLS (policies will be created in Step 46)
ALTER TABLE app_webhooks ENABLE ROW LEVEL SECURITY;




