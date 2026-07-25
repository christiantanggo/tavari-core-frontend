-- Add location tracking fields to waiver_signatures table for insurance requirements
-- Tracks where the waiver was signed (browser, kiosk, in-person, off-site)

ALTER TABLE waiver_signatures
ADD COLUMN IF NOT EXISTS location_latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS location_longitude DECIMAL(11, 8),
ADD COLUMN IF NOT EXISTS location_address TEXT,
ADD COLUMN IF NOT EXISTS location_source TEXT CHECK (location_source IN ('browser', 'kiosk', 'in_person', 'off_site', 'mobile_app')),
ADD COLUMN IF NOT EXISTS location_city TEXT,
ADD COLUMN IF NOT EXISTS location_state TEXT,
ADD COLUMN IF NOT EXISTS location_postal_code TEXT,
ADD COLUMN IF NOT EXISTS location_country TEXT DEFAULT 'CA';

-- Create index for location queries
CREATE INDEX IF NOT EXISTS idx_waiver_signatures_location 
ON waiver_signatures (business_id, location_source, signed_at DESC)
WHERE location_latitude IS NOT NULL;

-- Add comment
COMMENT ON COLUMN waiver_signatures.location_source IS 'Source of waiver signing: browser, kiosk, in_person, off_site, or mobile_app';
COMMENT ON COLUMN waiver_signatures.location_latitude IS 'GPS latitude where waiver was signed (for insurance requirements)';
COMMENT ON COLUMN waiver_signatures.location_longitude IS 'GPS longitude where waiver was signed (for insurance requirements)';





