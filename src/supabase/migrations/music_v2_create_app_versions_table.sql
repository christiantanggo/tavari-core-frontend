-- Create table to track desktop app versions for auto-updates
-- This table stores version information and download URLs

CREATE TABLE IF NOT EXISTS music_app_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_number VARCHAR(20) NOT NULL UNIQUE,
  release_notes TEXT,
  installer_url_windows TEXT,
  installer_url_mac TEXT,
  installer_url_linux TEXT,
  installer_size_windows BIGINT,
  installer_size_mac BIGINT,
  installer_size_linux BIGINT,
  installer_hash_windows TEXT,
  installer_hash_mac TEXT,
  installer_hash_linux TEXT,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'deprecated', 'beta')),
  is_required BOOLEAN DEFAULT false, -- Force update if true
  released_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_music_app_versions_status ON music_app_versions(status);
CREATE INDEX IF NOT EXISTS idx_music_app_versions_released_at ON music_app_versions(released_at DESC);

-- Enable RLS
ALTER TABLE music_app_versions ENABLE ROW LEVEL SECURITY;

-- Public read access (anyone can check for updates)
CREATE POLICY "Public read access for app versions"
ON music_app_versions FOR SELECT
USING (true);

-- Only authenticated users can insert/update (admins)
CREATE POLICY "Authenticated insert for app versions"
ON music_app_versions FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated update for app versions"
ON music_app_versions FOR UPDATE
USING (auth.role() = 'authenticated');

-- Function to get latest version
CREATE OR REPLACE FUNCTION get_latest_app_version()
RETURNS TABLE (
  version_number VARCHAR,
  release_notes TEXT,
  installer_url_windows TEXT,
  installer_url_mac TEXT,
  installer_url_linux TEXT,
  installer_size_windows BIGINT,
  installer_size_mac BIGINT,
  installer_size_linux BIGINT,
  is_required BOOLEAN,
  released_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.version_number,
    v.release_notes,
    v.installer_url_windows,
    v.installer_url_mac,
    v.installer_url_linux,
    v.installer_size_windows,
    v.installer_size_mac,
    v.installer_size_linux,
    v.is_required,
    v.released_at
  FROM music_app_versions v
  WHERE v.status = 'active'
  ORDER BY v.released_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_music_app_versions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER music_app_versions_updated_at
BEFORE UPDATE ON music_app_versions
FOR EACH ROW
EXECUTE FUNCTION update_music_app_versions_updated_at();


