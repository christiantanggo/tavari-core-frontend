-- Create digital_signage_screen_groups table
-- Purpose: Group screens together for easier management
-- Dependencies: None (only FK to businesses and users)

CREATE TABLE IF NOT EXISTS digital_signage_screen_groups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    group_name text NOT NULL,
    group_key text NOT NULL,
    description text,
    color_code text DEFAULT '#3B82F6',
    is_active boolean DEFAULT true,
    created_by uuid,
    created_at timestamptz DEFAULT timezone('utc'::text, now()),
    updated_at timestamptz DEFAULT timezone('utc'::text, now()),
    
    CONSTRAINT digital_signage_screen_groups_business_id_fkey 
        FOREIGN KEY (business_id) 
        REFERENCES businesses(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT digital_signage_screen_groups_created_by_fkey 
        FOREIGN KEY (created_by) 
        REFERENCES users(id) 
        ON DELETE SET NULL,
    
    CONSTRAINT digital_signage_screen_groups_business_key_unique 
        UNIQUE (business_id, group_key)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_digital_signage_screen_groups_business 
    ON digital_signage_screen_groups(business_id);

CREATE INDEX IF NOT EXISTS idx_digital_signage_screen_groups_business_active 
    ON digital_signage_screen_groups(business_id, is_active) 
    WHERE is_active = true;

-- Enable RLS
ALTER TABLE digital_signage_screen_groups ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE digital_signage_screen_groups IS 'Groups screens together for easier management and bulk operations';



