-- Add invoice file storage for draft expenses and create expense-invoices bucket

-- 1. Add column to accounting_draft_expenses (storage path in bucket expense-invoices)
ALTER TABLE accounting_draft_expenses
  ADD COLUMN IF NOT EXISTS invoice_file_path TEXT;

COMMENT ON COLUMN accounting_draft_expenses.invoice_file_path IS 'Storage path in bucket expense-invoices: {business_id}/{uuid}/{filename}';

-- 2. Create storage bucket for expense invoice uploads (private)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-invoices',
  'expense-invoices',
  false,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

-- 3. RLS policies: path format is business_id/unique_id/filename (foldername is 1-indexed: [1]=business_id, [2]=unique_id)
DROP POLICY IF EXISTS "Accounting managers can upload expense invoices" ON storage.objects;
CREATE POLICY "Accounting managers can upload expense invoices"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'expense-invoices'
  AND EXISTS (
    SELECT 1 FROM business_users
    WHERE business_users.user_id = auth.uid()
    AND business_users.business_id::text = (storage.foldername(name))[1]
    AND business_users.role IN ('owner', 'manager', 'admin')
  )
);

DROP POLICY IF EXISTS "Accounting managers can view expense invoices" ON storage.objects;
CREATE POLICY "Accounting managers can view expense invoices"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'expense-invoices'
  AND EXISTS (
    SELECT 1 FROM business_users
    WHERE business_users.user_id = auth.uid()
    AND business_users.business_id::text = (storage.foldername(name))[1]
    AND business_users.role IN ('owner', 'manager', 'admin')
  )
);

DROP POLICY IF EXISTS "Accounting managers can delete expense invoices" ON storage.objects;
CREATE POLICY "Accounting managers can delete expense invoices"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'expense-invoices'
  AND EXISTS (
    SELECT 1 FROM business_users
    WHERE business_users.user_id = auth.uid()
    AND business_users.business_id::text = (storage.foldername(name))[1]
    AND business_users.role IN ('owner', 'manager', 'admin')
  )
);
