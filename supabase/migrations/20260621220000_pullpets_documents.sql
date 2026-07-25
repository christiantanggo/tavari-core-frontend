-- Pet documents (lab results, receipts, prescriptions) — Premium feature.

CREATE TABLE IF NOT EXISTS public.pullpets_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES public.pullpets_pets(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('lab', 'prescription', 'receipt', 'vet_record', 'insurance', 'other')),
  file_name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  file_size integer,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pullpets_documents_pet
  ON public.pullpets_documents (pet_id, category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pullpets_documents_user
  ON public.pullpets_documents (user_id, created_at DESC);

ALTER TABLE public.pullpets_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pullpets_documents_owner ON public.pullpets_documents;
CREATE POLICY pullpets_documents_owner ON public.pullpets_documents
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.pullpets_is_pet_owner(pet_id))
  WITH CHECK (user_id = auth.uid() AND public.pullpets_is_pet_owner(pet_id));

DROP POLICY IF EXISTS pullpets_documents_helper_select ON public.pullpets_documents;
CREATE POLICY pullpets_documents_helper_select ON public.pullpets_documents
  FOR SELECT TO authenticated
  USING (public.pullpets_helper_can_access_pet(pet_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pullpets_documents TO authenticated;

-- Storage bucket: path {user_id}/{pet_id}/{filename}
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pullpets-documents',
  'pullpets-documents',
  false,
  26214400,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS pullpets_documents_storage_owner ON storage.objects;
CREATE POLICY pullpets_documents_storage_owner ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'pullpets-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'pullpets-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS pullpets_documents_storage_helper_read ON storage.objects;
CREATE POLICY pullpets_documents_storage_helper_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'pullpets-documents'
    AND public.pullpets_helper_can_access_pet(((storage.foldername(name))[2])::uuid)
  );
