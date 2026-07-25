-- Fix music_app_versions table - add missing columns if they don't exist
-- This handles the case where the table was created before all columns were defined

-- Add columns if they don't exist
DO $$ 
BEGIN
  -- Windows installer URL
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'music_app_versions' 
    AND column_name = 'installer_url_windows'
  ) THEN
    ALTER TABLE music_app_versions ADD COLUMN installer_url_windows TEXT;
  END IF;

  -- Mac installer URL
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'music_app_versions' 
    AND column_name = 'installer_url_mac'
  ) THEN
    ALTER TABLE music_app_versions ADD COLUMN installer_url_mac TEXT;
  END IF;

  -- Linux installer URL
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'music_app_versions' 
    AND column_name = 'installer_url_linux'
  ) THEN
    ALTER TABLE music_app_versions ADD COLUMN installer_url_linux TEXT;
  END IF;

  -- Windows installer size
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'music_app_versions' 
    AND column_name = 'installer_size_windows'
  ) THEN
    ALTER TABLE music_app_versions ADD COLUMN installer_size_windows BIGINT;
  END IF;

  -- Mac installer size
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'music_app_versions' 
    AND column_name = 'installer_size_mac'
  ) THEN
    ALTER TABLE music_app_versions ADD COLUMN installer_size_mac BIGINT;
  END IF;

  -- Linux installer size
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'music_app_versions' 
    AND column_name = 'installer_size_linux'
  ) THEN
    ALTER TABLE music_app_versions ADD COLUMN installer_size_linux BIGINT;
  END IF;

  -- Windows installer hash
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'music_app_versions' 
    AND column_name = 'installer_hash_windows'
  ) THEN
    ALTER TABLE music_app_versions ADD COLUMN installer_hash_windows TEXT;
  END IF;

  -- Mac installer hash
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'music_app_versions' 
    AND column_name = 'installer_hash_mac'
  ) THEN
    ALTER TABLE music_app_versions ADD COLUMN installer_hash_mac TEXT;
  END IF;

  -- Linux installer hash
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'music_app_versions' 
    AND column_name = 'installer_hash_linux'
  ) THEN
    ALTER TABLE music_app_versions ADD COLUMN installer_hash_linux TEXT;
  END IF;

  -- Status column with check constraint
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'music_app_versions' 
    AND column_name = 'status'
  ) THEN
    ALTER TABLE music_app_versions ADD COLUMN status VARCHAR(20) DEFAULT 'active';
    ALTER TABLE music_app_versions ADD CONSTRAINT music_app_versions_status_check 
      CHECK (status IN ('active', 'deprecated', 'beta'));
  END IF;

  -- Is required column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'music_app_versions' 
    AND column_name = 'is_required'
  ) THEN
    ALTER TABLE music_app_versions ADD COLUMN is_required BOOLEAN DEFAULT false;
  END IF;

  -- Released at column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'music_app_versions' 
    AND column_name = 'released_at'
  ) THEN
    ALTER TABLE music_app_versions ADD COLUMN released_at TIMESTAMPTZ DEFAULT NOW();
  END IF;

  -- Updated at column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'music_app_versions' 
    AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE music_app_versions ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- Refresh schema cache (PostgREST needs this)
NOTIFY pgrst, 'reload schema';


