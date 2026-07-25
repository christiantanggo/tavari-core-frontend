-- Create storage bucket for social media images
-- Bucket for storing images used in social media posts (Instagram, Facebook, etc.)

-- First, try to update existing bucket
UPDATE storage.buckets
SET 
  public = true, -- Public access needed for Instagram/Facebook to access images
  file_size_limit = 10485760, -- 10MB limit
  allowed_mime_types = ARRAY[
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp'
  ]
WHERE id = 'social-media-images';

-- If bucket doesn't exist, create it
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT
  'social-media-images',
  'social-media-images',
  true, -- Public access for social media platforms
  10485760, -- 10MB limit
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp'
  ]
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'social-media-images');


