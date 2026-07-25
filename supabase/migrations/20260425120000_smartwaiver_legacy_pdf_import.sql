-- Smartwaiver PDF archive import support.
-- Smartwaiver rows are stored in legacy_waivers with source_system = 'smartwaiver'.

ALTER TABLE public.legacy_waivers
  ADD COLUMN IF NOT EXISTS external_document_id text,
  ADD COLUMN IF NOT EXISTS imported_pdf_storage_path text,
  ADD COLUMN IF NOT EXISTS imported_pdf_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS imported_pdf_sha256 text,
  ADD COLUMN IF NOT EXISTS imported_pdf_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS legacy_waivers_business_source_external_doc_unique
  ON public.legacy_waivers (business_id, source_system, external_document_id)
  WHERE external_document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_legacy_waivers_business_source_external_doc
  ON public.legacy_waivers (business_id, source_system, external_document_id)
  WHERE external_document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_legacy_waivers_business_pdf_sha
  ON public.legacy_waivers (business_id, imported_pdf_sha256)
  WHERE imported_pdf_sha256 IS NOT NULL;

COMMENT ON COLUMN public.legacy_waivers.external_document_id IS
  'Source-system document id, e.g. Smartwaiver Document ID.';

COMMENT ON COLUMN public.legacy_waivers.imported_pdf_storage_path IS
  'Private Supabase Storage object path for imported source PDF.';

COMMENT ON COLUMN public.legacy_waivers.imported_pdf_meta IS
  'Raw/importer-derived metadata and parse confidence for imported source PDFs.';

DROP POLICY IF EXISTS "Smartwaiver import PDFs select for business members" ON storage.objects;
CREATE POLICY "Smartwaiver import PDFs select for business members"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'waivers'
    AND split_part(name, '/', 1) = 'smartwaiver-imports'
    AND (
      EXISTS (
        SELECT 1 FROM public.business_users bu
        WHERE bu.user_id = auth.uid()
          AND bu.business_id = split_part(name, '/', 2)::uuid
      )
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.active = true
          AND ur.business_id = split_part(name, '/', 2)::uuid
      )
    )
  );

DROP POLICY IF EXISTS "Smartwaiver import PDFs insert for business members" ON storage.objects;
CREATE POLICY "Smartwaiver import PDFs insert for business members"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'waivers'
    AND split_part(name, '/', 1) = 'smartwaiver-imports'
    AND name ~* '^smartwaiver-imports/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+\.pdf$'
    AND (
      EXISTS (
        SELECT 1 FROM public.business_users bu
        WHERE bu.user_id = auth.uid()
          AND bu.business_id = split_part(name, '/', 2)::uuid
      )
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.active = true
          AND ur.business_id = split_part(name, '/', 2)::uuid
      )
    )
  );
