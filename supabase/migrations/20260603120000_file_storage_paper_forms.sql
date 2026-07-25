-- Paper Forms: printable blank/legacy form templates for staff (File Storage module)
-- Storage path: business-files/{business_id}/paper-forms/{uuid}_{filename}

CREATE TABLE IF NOT EXISTS public.file_storage_paper_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'business-files',
  file_path TEXT NOT NULL,
  original_filename TEXT,
  mime_type TEXT,
  file_size BIGINT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_file_storage_paper_forms_business
  ON public.file_storage_paper_forms (business_id, name)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_file_storage_paper_forms_updated
  ON public.file_storage_paper_forms (business_id, updated_at DESC)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_file_storage_paper_forms_updated ON public.file_storage_paper_forms;
CREATE TRIGGER trg_file_storage_paper_forms_updated
  BEFORE UPDATE ON public.file_storage_paper_forms
  FOR EACH ROW EXECUTE FUNCTION public.touch_file_storage_updated_at();

ALTER TABLE public.file_storage_paper_forms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "file_storage_paper_forms_select" ON public.file_storage_paper_forms;
CREATE POLICY "file_storage_paper_forms_select"
  ON public.file_storage_paper_forms FOR SELECT
  USING (public.is_file_storage_business_member(business_id));

DROP POLICY IF EXISTS "file_storage_paper_forms_insert" ON public.file_storage_paper_forms;
CREATE POLICY "file_storage_paper_forms_insert"
  ON public.file_storage_paper_forms FOR INSERT
  WITH CHECK (public.is_file_storage_business_member(business_id));

DROP POLICY IF EXISTS "file_storage_paper_forms_update" ON public.file_storage_paper_forms;
CREATE POLICY "file_storage_paper_forms_update"
  ON public.file_storage_paper_forms FOR UPDATE
  USING (public.is_file_storage_business_member(business_id))
  WITH CHECK (public.is_file_storage_business_member(business_id));

DROP POLICY IF EXISTS "file_storage_paper_forms_delete" ON public.file_storage_paper_forms;
CREATE POLICY "file_storage_paper_forms_delete"
  ON public.file_storage_paper_forms FOR DELETE
  USING (public.is_file_storage_business_member(business_id));

COMMENT ON TABLE public.file_storage_paper_forms IS 'Printable blank/legacy form templates for staff; stored under business-files/{business_id}/paper-forms/';
