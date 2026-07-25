-- POS Product Images: storage bucket, RLS policies, and pos_inventory.image_url support
-- If this migration hangs, run the 3 sections below separately in the SQL Editor (run Section 1, then 2, then 3).

-- ========== SECTION 1: Table column + index (no storage; run first) ==========
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pos_inventory'
      AND column_name = 'image_url'
  ) THEN
    ALTER TABLE pos_inventory ADD COLUMN image_url TEXT;
    COMMENT ON COLUMN pos_inventory.image_url IS 'Public URL of product image in storage bucket pos-product-images; shown on POS register buttons.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pos_inventory_image_url
ON pos_inventory(image_url)
WHERE image_url IS NOT NULL;

-- ========== SECTION 2: Bucket only (run second; if it hangs, create bucket in Dashboard: Storage -> New bucket -> id: pos-product-images, Public: ON, 2MB, image/*) ==========
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pos-product-images',
  'pos-product-images',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- ========== SECTION 3: RLS policies (run third) ==========
DROP POLICY IF EXISTS "POS product images: upload by business members" ON storage.objects;
DROP POLICY IF EXISTS "POS product images: read" ON storage.objects;
DROP POLICY IF EXISTS "POS product images: delete by business members" ON storage.objects;
DROP POLICY IF EXISTS "POS product images: update by business members" ON storage.objects;

CREATE POLICY "POS product images: upload by business members"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'pos-product-images'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.active = true
      AND ur.business_id::text = (storage.foldername(name))[1]
      AND ur.role IN ('owner', 'manager', 'employee', 'cashier')
  )
);

-- Read: allow all roles (omit TO so it applies to everyone)
CREATE POLICY "POS product images: read"
ON storage.objects FOR SELECT
USING (bucket_id = 'pos-product-images');

CREATE POLICY "POS product images: delete by business members"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'pos-product-images'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.active = true
      AND ur.business_id::text = (storage.foldername(name))[1]
      AND ur.role IN ('owner', 'manager', 'employee', 'cashier')
  )
);

CREATE POLICY "POS product images: update by business members"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'pos-product-images'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.active = true
      AND ur.business_id::text = (storage.foldername(name))[1]
      AND ur.role IN ('owner', 'manager', 'employee', 'cashier')
  )
);
