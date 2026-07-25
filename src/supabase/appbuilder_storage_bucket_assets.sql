-- Step 18: Create storage bucket appbuilder-assets
-- Bucket for storing app logos, icons, splash screens, screenshots

-- First, try to update existing bucket
UPDATE storage.buckets
SET 
  public = true, -- required for <img> public URLs (waiver / portal; no JWT on image GET)
  file_size_limit = 52428800, -- 50MB limit
  allowed_mime_types = ARRAY[
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/x-icon',
    'image/vnd.microsoft.icon'
  ]
WHERE id = 'appbuilder-assets';

-- If bucket doesn't exist, create it
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT
  'appbuilder-assets',
  'appbuilder-assets',
  true, -- Public read so branding URLs work in <img> on anonymous pages
  52428800, -- 50MB limit
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/x-icon',
    'image/vnd.microsoft.icon'
  ]
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'appbuilder-assets');




