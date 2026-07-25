-- File Storage module: categories, files, inbound email queue, access log, settings, bucket

-- ---------------------------------------------------------------------------
-- Settings (per-business inbox local part + domain, like accounting)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.file_storage_settings (
  business_id UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  inbox_local_part TEXT NOT NULL,
  inbox_domain TEXT NOT NULL DEFAULT 'tavarios.ca',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS file_storage_settings_inbox_unique
  ON public.file_storage_settings (lower(trim(inbox_domain)), lower(trim(inbox_local_part)));

-- ---------------------------------------------------------------------------
-- Categories (hierarchical; system row = paper waiver bridge)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.file_storage_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.file_storage_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  icon_key TEXT,
  color TEXT,
  retention_years INT,
  show_document_start BOOLEAN NOT NULL DEFAULT true,
  show_document_end BOOLEAN NOT NULL DEFAULT true,
  is_system BOOLEAN NOT NULL DEFAULT false,
  system_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_file_storage_categories_paper_waiver
  ON public.file_storage_categories (business_id)
  WHERE system_key = 'paper_waiver';

CREATE INDEX IF NOT EXISTS idx_file_storage_categories_business
  ON public.file_storage_categories (business_id, parent_id, sort_order);

-- ---------------------------------------------------------------------------
-- Approved / active files
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.file_storage_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.file_storage_categories(id) ON DELETE RESTRICT,
  storage_bucket TEXT NOT NULL DEFAULT 'business-files',
  file_path TEXT NOT NULL,
  original_filename TEXT,
  mime_type TEXT,
  file_size BIGINT,
  display_name TEXT,
  document_date_start DATE,
  document_date_end DATE,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by UUID REFERENCES auth.users(id),
  source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'email')),
  approval_status TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES auth.users(id),
  retention_soft_deleted_at TIMESTAMPTZ,
  legal_hold BOOLEAN NOT NULL DEFAULT false,
  retention_anchor_date DATE,
  linked_module_key TEXT,
  linked_entity_id UUID,
  waiver_upload_id UUID REFERENCES public.waiver_uploads(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_file_storage_files_business_category
  ON public.file_storage_files (business_id, category_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_file_storage_files_retention
  ON public.file_storage_files (business_id, retention_soft_deleted_at)
  WHERE legal_hold = false AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Email / manual pending queue (not yet in a category)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.file_storage_inbound (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  message_id TEXT,
  from_address TEXT,
  subject TEXT,
  file_path TEXT NOT NULL,
  original_filename TEXT,
  mime_type TEXT,
  file_size BIGINT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  file_storage_file_id UUID REFERENCES public.file_storage_files(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_file_storage_inbound_business_status
  ON public.file_storage_inbound (business_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- View / download audit (owner export reports can use this too)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.file_storage_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES public.file_storage_files(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL CHECK (action IN ('view', 'download', 'export_zip')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta JSONB
);

CREATE INDEX IF NOT EXISTS idx_file_storage_access_log_file
  ON public.file_storage_access_log (file_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Triggers: updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_file_storage_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_file_storage_settings_updated ON public.file_storage_settings;
CREATE TRIGGER trg_file_storage_settings_updated
  BEFORE UPDATE ON public.file_storage_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_file_storage_updated_at();

DROP TRIGGER IF EXISTS trg_file_storage_categories_updated ON public.file_storage_categories;
CREATE TRIGGER trg_file_storage_categories_updated
  BEFORE UPDATE ON public.file_storage_categories
  FOR EACH ROW EXECUTE FUNCTION public.touch_file_storage_updated_at();

DROP TRIGGER IF EXISTS trg_file_storage_files_updated ON public.file_storage_files;
CREATE TRIGGER trg_file_storage_files_updated
  BEFORE UPDATE ON public.file_storage_files
  FOR EACH ROW EXECUTE FUNCTION public.touch_file_storage_updated_at();

-- ---------------------------------------------------------------------------
-- Only owner may set deleted_at (soft delete)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.file_storage_enforce_owner_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND NEW.deleted_at IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = NEW.business_id
        AND bu.user_id = auth.uid()
        AND bu.role = 'owner'
    ) AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.business_id = NEW.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role = 'owner'
    ) THEN
      RAISE EXCEPTION 'Only business owner can delete files';
    END IF;
    IF NEW.deleted_by IS NULL THEN
      NEW.deleted_by := auth.uid();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_file_storage_files_owner_delete ON public.file_storage_files;
CREATE TRIGGER trg_file_storage_files_owner_delete
  BEFORE UPDATE ON public.file_storage_files
  FOR EACH ROW EXECUTE FUNCTION public.file_storage_enforce_owner_delete();

-- ---------------------------------------------------------------------------
-- Ensure default settings + paper waiver category (call from app on first load)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_file_storage_defaults(p_business_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local TEXT;
BEGIN
  v_local := 'files-' || REPLACE(p_business_id::TEXT, '-', '');

  INSERT INTO public.file_storage_settings (business_id, inbox_local_part, inbox_domain)
  VALUES (p_business_id, v_local, 'tavarios.ca')
  ON CONFLICT (business_id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM public.file_storage_categories c
    WHERE c.business_id = p_business_id AND c.system_key = 'paper_waiver'
  ) THEN
    INSERT INTO public.file_storage_categories (
      business_id, parent_id, name, sort_order, icon_key, color,
      retention_years, show_document_start, show_document_end, is_system, system_key
    )
    VALUES (
      p_business_id, NULL, 'Paper waivers', 0, '📄', '#2563eb',
      NULL, true, true, true, 'paper_waiver'
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Retention sweep: soft-delete rows past policy (document end + years + 6 months)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.file_storage_retention_sweep(p_business_id UUID DEFAULT NULL)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INT := 0;
BEGIN
  UPDATE public.file_storage_files f
  SET
    retention_soft_deleted_at = now(),
    updated_at = now()
  FROM public.file_storage_categories c
  WHERE f.category_id = c.id
    AND f.deleted_at IS NULL
    AND f.retention_soft_deleted_at IS NULL
    AND f.legal_hold = false
    AND c.retention_years IS NOT NULL
    AND (p_business_id IS NULL OR f.business_id = p_business_id)
    AND (
      COALESCE(f.document_date_end, f.document_date_start, (f.uploaded_at)::DATE)
      + (c.retention_years * INTERVAL '1 year')
      + INTERVAL '6 months'
    ) < CURRENT_DATE;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ---------------------------------------------------------------------------
-- Storage bucket (private)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'business-files',
  'business-files',
  false,
  52428800,
  NULL
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.file_storage_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_storage_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_storage_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_storage_inbound ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_storage_access_log ENABLE ROW LEVEL SECURITY;

-- Helper: business member (employee, manager, owner, admin)
CREATE OR REPLACE FUNCTION public.is_file_storage_business_member(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.business_users bu
    WHERE bu.business_id = p_business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('owner', 'manager', 'employee', 'admin')
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.business_id = p_business_id
      AND ur.user_id = auth.uid()
      AND ur.active = true
      AND ur.role IN ('owner', 'manager', 'employee', 'admin')
  );
$$;

DROP POLICY IF EXISTS "file_storage_settings_select" ON public.file_storage_settings;
DROP POLICY IF EXISTS "file_storage_settings_all" ON public.file_storage_settings;
CREATE POLICY "file_storage_settings_all"
  ON public.file_storage_settings FOR ALL
  USING (public.is_file_storage_business_member(business_id))
  WITH CHECK (public.is_file_storage_business_member(business_id));

DROP POLICY IF EXISTS "file_storage_categories_select" ON public.file_storage_categories;
CREATE POLICY "file_storage_categories_select"
  ON public.file_storage_categories FOR SELECT
  USING (public.is_file_storage_business_member(business_id));

DROP POLICY IF EXISTS "file_storage_categories_insert" ON public.file_storage_categories;
CREATE POLICY "file_storage_categories_insert"
  ON public.file_storage_categories FOR INSERT
  WITH CHECK (public.is_file_storage_business_member(business_id) AND NOT is_system);

DROP POLICY IF EXISTS "file_storage_categories_update" ON public.file_storage_categories;
CREATE POLICY "file_storage_categories_update"
  ON public.file_storage_categories FOR UPDATE
  USING (public.is_file_storage_business_member(business_id))
  WITH CHECK (public.is_file_storage_business_member(business_id));

DROP POLICY IF EXISTS "file_storage_categories_delete" ON public.file_storage_categories;
CREATE POLICY "file_storage_categories_delete"
  ON public.file_storage_categories FOR DELETE
  USING (public.is_file_storage_business_member(business_id) AND is_system = false);

DROP POLICY IF EXISTS "file_storage_files_select" ON public.file_storage_files;
CREATE POLICY "file_storage_files_select"
  ON public.file_storage_files FOR SELECT
  USING (public.is_file_storage_business_member(business_id));

DROP POLICY IF EXISTS "file_storage_files_insert" ON public.file_storage_files;
CREATE POLICY "file_storage_files_insert"
  ON public.file_storage_files FOR INSERT
  WITH CHECK (public.is_file_storage_business_member(business_id));

DROP POLICY IF EXISTS "file_storage_files_update" ON public.file_storage_files;
CREATE POLICY "file_storage_files_update"
  ON public.file_storage_files FOR UPDATE
  USING (public.is_file_storage_business_member(business_id))
  WITH CHECK (public.is_file_storage_business_member(business_id));

DROP POLICY IF EXISTS "file_storage_inbound_select" ON public.file_storage_inbound;
CREATE POLICY "file_storage_inbound_select"
  ON public.file_storage_inbound FOR SELECT
  USING (public.is_file_storage_business_member(business_id));

DROP POLICY IF EXISTS "file_storage_inbound_update" ON public.file_storage_inbound;
CREATE POLICY "file_storage_inbound_update"
  ON public.file_storage_inbound FOR UPDATE
  USING (public.is_file_storage_business_member(business_id))
  WITH CHECK (public.is_file_storage_business_member(business_id));

DROP POLICY IF EXISTS "file_storage_access_log_select" ON public.file_storage_access_log;
CREATE POLICY "file_storage_access_log_select"
  ON public.file_storage_access_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = file_storage_access_log.business_id
        AND bu.user_id = auth.uid()
        AND bu.role = 'owner'
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.business_id = file_storage_access_log.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role = 'owner'
    )
  );

DROP POLICY IF EXISTS "file_storage_access_log_insert" ON public.file_storage_access_log;
CREATE POLICY "file_storage_access_log_insert"
  ON public.file_storage_access_log FOR INSERT
  WITH CHECK (public.is_file_storage_business_member(business_id));

-- Inbound: only service role (receive-email) inserts
DROP POLICY IF EXISTS "file_storage_inbound_insert" ON public.file_storage_inbound;
CREATE POLICY "file_storage_inbound_insert"
  ON public.file_storage_inbound FOR INSERT
  WITH CHECK (false);

-- Storage policies for business-files
DROP POLICY IF EXISTS "business_files_objects_select" ON storage.objects;
DROP POLICY IF EXISTS "business_files_objects_insert" ON storage.objects;
DROP POLICY IF EXISTS "business_files_objects_update" ON storage.objects;
DROP POLICY IF EXISTS "business_files_objects_delete" ON storage.objects;

CREATE POLICY "business_files_objects_select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'business-files'
    AND public.is_file_storage_business_member(
      (string_to_array(name, '/'))[1]::uuid
    )
  );

CREATE POLICY "business_files_objects_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'business-files'
    AND public.is_file_storage_business_member(
      (string_to_array(name, '/'))[1]::uuid
    )
  );

CREATE POLICY "business_files_objects_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'business-files'
    AND public.is_file_storage_business_member(
      (string_to_array(name, '/'))[1]::uuid
    )
  );

CREATE POLICY "business_files_objects_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'business-files'
    AND (
      EXISTS (
        SELECT 1 FROM public.business_users bu
        WHERE bu.user_id = auth.uid()
          AND bu.role = 'owner'
          AND bu.business_id = (string_to_array(name, '/'))[1]::uuid
      )
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.active = true
          AND ur.role = 'owner'
          AND ur.business_id = (string_to_array(name, '/'))[1]::uuid
      )
    )
  );

COMMENT ON TABLE public.file_storage_files IS 'Storage path under business-files: {business_id}/...';

-- ---------------------------------------------------------------------------
-- app_modules catalog
-- ---------------------------------------------------------------------------
INSERT INTO public.app_modules (module_key, module_name, description, icon, enabled_by_default, module_category)
VALUES (
  'file_storage',
  'File Storage',
  'Central document storage, categories, email intake, retention, and waiver uploads',
  'FiFolder',
  true,
  'Operations'
)
ON CONFLICT (module_key) DO UPDATE
SET
  module_name = EXCLUDED.module_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  module_category = EXCLUDED.module_category,
  enabled_by_default = EXCLUDED.enabled_by_default;

-- ---------------------------------------------------------------------------
-- Migrate cashier -> employee
-- ---------------------------------------------------------------------------
UPDATE public.user_roles SET role = 'employee' WHERE role = 'cashier';
UPDATE public.business_users SET role = 'employee' WHERE role = 'cashier';

GRANT EXECUTE ON FUNCTION public.ensure_file_storage_defaults(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.file_storage_retention_sweep(UUID) TO service_role;
