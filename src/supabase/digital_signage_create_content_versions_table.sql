-- Create digital_signage_content_versions table
-- Purpose: Version history for content items
-- Dependencies: FK to digital_signage_content

CREATE TABLE IF NOT EXISTS digital_signage_content_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id uuid NOT NULL,
    version_number integer NOT NULL,
    file_url text,
    file_path text,
    file_size bigint,
    width integer,
    height integer,
    duration_seconds integer,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_by uuid,
    created_at timestamptz DEFAULT timezone('utc'::text, now()),
    
    CONSTRAINT digital_signage_content_versions_content_id_fkey 
        FOREIGN KEY (content_id) 
        REFERENCES digital_signage_content(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT digital_signage_content_versions_created_by_fkey 
        FOREIGN KEY (created_by) 
        REFERENCES users(id) 
        ON DELETE SET NULL,
    
    CONSTRAINT digital_signage_content_versions_content_version_unique 
        UNIQUE (content_id, version_number)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_digital_signage_content_versions_content 
    ON digital_signage_content_versions(content_id, version_number DESC);

-- Enable RLS
ALTER TABLE digital_signage_content_versions ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE digital_signage_content_versions IS 'Version history for content items';



