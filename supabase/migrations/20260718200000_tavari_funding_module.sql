-- Tavari Funding — business plans, loan/grant applications, Deductly program alerts

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO public.app_modules (module_key, module_name, description, icon, enabled_by_default, module_category)
VALUES (
  'funding',
  'Tavari Funding',
  'Business plans, loan and grant applications, scenarios, collaborators, and Canadian funding program alerts',
  'FiDollarSign',
  false,
  'Finance'
)
ON CONFLICT (module_key) DO UPDATE SET
  module_name = EXCLUDED.module_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  module_category = EXCLUDED.module_category;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.funding_is_business_member(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.business_users bu
    WHERE bu.business_id = p_business_id AND bu.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.business_id = p_business_id AND ur.user_id = auth.uid() AND ur.active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.funding_is_business_owner(p_business_id UUID)
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
      AND bu.role IN ('owner', 'admin')
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.business_id = p_business_id
      AND ur.user_id = auth.uid()
      AND ur.active = true
      AND ur.role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.funding_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funding_settings (
  business_id UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  deductly_province TEXT,
  deductly_industry TEXT,
  deductly_program_types TEXT[] NOT NULL DEFAULT ARRAY['grant']::text[],
  deductly_alerts_enabled BOOLEAN NOT NULL DEFAULT true,
  ai_tone TEXT NOT NULL DEFAULT 'professional Canadian business English',
  default_data_pulls JSONB NOT NULL DEFAULT '{
    "business_profile": true,
    "address": true,
    "tax_number": false,
    "operating_hours": false,
    "live_pnl": false,
    "live_balance_sheet": false,
    "live_cash_flow": false,
    "payroll_summary": false,
    "pos_sales": false,
    "projections": true,
    "collateral": false,
    "personal_net_worth": false
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_funding_settings_updated_at ON public.funding_settings;
CREATE TRIGGER trg_funding_settings_updated_at
  BEFORE UPDATE ON public.funding_settings
  FOR EACH ROW EXECUTE FUNCTION public.funding_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funding_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idea'
    CHECK (status IN ('idea', 'draft', 'ready', 'submitted', 'approved', 'denied', 'withdrawn')),
  entity_scope TEXT NOT NULL DEFAULT 'current_business'
    CHECK (entity_scope IN ('current_business', 'expansion', 'new_venture', 'multi')),
  target_business_name TEXT,
  data_pull_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  create_business_config JSONB NOT NULL DEFAULT '{
    "copy_profile": true,
    "copy_projections": true,
    "copy_documents": false,
    "copy_team_access": false,
    "copy_plan_content": true
  }'::jsonb,
  linked_business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funding_plans_business
  ON public.funding_plans (business_id, status, updated_at DESC);

DROP TRIGGER IF EXISTS trg_funding_plans_updated_at ON public.funding_plans;
CREATE TRIGGER trg_funding_plans_updated_at
  BEFORE UPDATE ON public.funding_plans
  FOR EACH ROW EXECUTE FUNCTION public.funding_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.funding_plan_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.funding_plans(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  title TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  content TEXT NOT NULL DEFAULT '',
  collapsed_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, section_key)
);

CREATE INDEX IF NOT EXISTS idx_funding_plan_sections_plan
  ON public.funding_plan_sections (plan_id, sort_order);

DROP TRIGGER IF EXISTS trg_funding_plan_sections_updated_at ON public.funding_plan_sections;
CREATE TRIGGER trg_funding_plan_sections_updated_at
  BEFORE UPDATE ON public.funding_plan_sections
  FOR EACH ROW EXECUTE FUNCTION public.funding_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.funding_plan_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.funding_plans(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  snapshot JSONB NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_funding_plan_versions_plan
  ON public.funding_plan_versions (plan_id, version_number DESC);

-- ---------------------------------------------------------------------------
-- Scenarios (current / expansion / new venture projections)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funding_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.funding_plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scenario_type TEXT NOT NULL DEFAULT 'expansion'
    CHECK (scenario_type IN ('current', 'expansion', 'new_venture', 'custom')),
  assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
  projections JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funding_scenarios_plan
  ON public.funding_scenarios (plan_id, sort_order);

DROP TRIGGER IF EXISTS trg_funding_scenarios_updated_at ON public.funding_scenarios;
CREATE TRIGGER trg_funding_scenarios_updated_at
  BEFORE UPDATE ON public.funding_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.funding_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funding_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES public.funding_plans(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  application_type TEXT NOT NULL DEFAULT 'grant'
    CHECK (application_type IN ('grant', 'loan', 'line_of_credit', 'investor', 'other')),
  funder_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idea'
    CHECK (status IN ('idea', 'draft', 'ready', 'submitted', 'approved', 'denied', 'withdrawn')),
  amount_requested NUMERIC(14, 2),
  currency TEXT NOT NULL DEFAULT 'CAD',
  deadline_date DATE,
  submitted_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  data_pull_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  deductly_program_id TEXT,
  reminder_id UUID,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funding_applications_business
  ON public.funding_applications (business_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_funding_applications_plan
  ON public.funding_applications (plan_id);

DROP TRIGGER IF EXISTS trg_funding_applications_updated_at ON public.funding_applications;
CREATE TRIGGER trg_funding_applications_updated_at
  BEFORE UPDATE ON public.funding_applications
  FOR EACH ROW EXECUTE FUNCTION public.funding_touch_updated_at();

-- Link several applications under one master plan / package
CREATE TABLE IF NOT EXISTS public.funding_application_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.funding_plans(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES public.funding_applications(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, application_id)
);

-- ---------------------------------------------------------------------------
-- Funder-specific question banks (per-business configurable)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funding_funder_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  funder_type TEXT NOT NULL DEFAULT 'grant'
    CHECK (funder_type IN ('grant', 'loan', 'line_of_credit', 'investor', 'other')),
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_funding_funder_templates_updated_at ON public.funding_funder_templates;
CREATE TRIGGER trg_funding_funder_templates_updated_at
  BEFORE UPDATE ON public.funding_funder_templates
  FOR EACH ROW EXECUTE FUNCTION public.funding_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.funding_funder_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.funding_funder_templates(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  label TEXT NOT NULL,
  help_text TEXT NOT NULL DEFAULT '',
  field_type TEXT NOT NULL DEFAULT 'text'
    CHECK (field_type IN ('text', 'textarea', 'number', 'currency', 'date', 'boolean', 'file')),
  required BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, question_key)
);

CREATE TABLE IF NOT EXISTS public.funding_application_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES public.funding_applications(id) ON DELETE CASCADE,
  question_id UUID REFERENCES public.funding_funder_questions(id) ON DELETE SET NULL,
  question_key TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  value_text TEXT NOT NULL DEFAULT '',
  value_json JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, question_key)
);

-- ---------------------------------------------------------------------------
-- Checklists
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funding_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES public.funding_plans(id) ON DELETE CASCADE,
  application_id UUID REFERENCES public.funding_applications(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT false,
  due_date DATE,
  sort_order INT NOT NULL DEFAULT 0,
  reminder_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (plan_id IS NOT NULL OR application_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_funding_checklist_app
  ON public.funding_checklist_items (application_id, sort_order);

DROP TRIGGER IF EXISTS trg_funding_checklist_updated_at ON public.funding_checklist_items;
CREATE TRIGGER trg_funding_checklist_updated_at
  BEFORE UPDATE ON public.funding_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.funding_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Collaborators (staff + guests)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funding_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES public.funding_plans(id) ON DELETE CASCADE,
  application_id UUID REFERENCES public.funding_applications(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  guest_email TEXT,
  access_level TEXT NOT NULL DEFAULT 'view'
    CHECK (access_level IN ('view', 'edit')),
  can_see_financials BOOLEAN NOT NULL DEFAULT false,
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR guest_email IS NOT NULL),
  CHECK (plan_id IS NOT NULL OR application_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_funding_collaborators_business
  ON public.funding_collaborators (business_id);

CREATE TABLE IF NOT EXISTS public.funding_guest_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  collaborator_id UUID NOT NULL REFERENCES public.funding_collaborators(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'view'
    CHECK (access_level IN ('view', 'edit')),
  can_see_financials BOOLEAN NOT NULL DEFAULT false,
  plan_id UUID REFERENCES public.funding_plans(id) ON DELETE CASCADE,
  application_id UUID REFERENCES public.funding_applications(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funding_guest_tokens_token
  ON public.funding_guest_tokens (token)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Financial snapshots (live pull vs projections — stays out of Accounting)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funding_financial_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES public.funding_plans(id) ON DELETE CASCADE,
  application_id UUID REFERENCES public.funding_applications(id) ON DELETE CASCADE,
  scenario_id UUID REFERENCES public.funding_scenarios(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL DEFAULT 'projection'
    CHECK (source_type IN ('live', 'projection', 'manual')),
  label TEXT NOT NULL DEFAULT 'Financials',
  enabled_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_funding_financial_snapshots_updated_at ON public.funding_financial_snapshots;
CREATE TRIGGER trg_funding_financial_snapshots_updated_at
  BEFORE UPDATE ON public.funding_financial_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.funding_touch_updated_at();

-- Sensitive PII (encrypted at rest via pgcrypto; key from app settings when available)
CREATE TABLE IF NOT EXISTS public.funding_sensitive_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES public.funding_plans(id) ON DELETE CASCADE,
  application_id UUID REFERENCES public.funding_applications(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  value_encrypted TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funding_sensitive_app
  ON public.funding_sensitive_fields (application_id, field_key);

-- ---------------------------------------------------------------------------
-- Deductly program cache + alerts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funding_program_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  deductly_program_id TEXT NOT NULL,
  name TEXT NOT NULL,
  program_type TEXT,
  description TEXT NOT NULL DEFAULT '',
  estimated_value TEXT,
  application_url TEXT,
  deadline TEXT,
  eligibility JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_new BOOLEAN NOT NULL DEFAULT true,
  dismissed_at TIMESTAMPTZ,
  UNIQUE (business_id, deductly_program_id)
);

CREATE INDEX IF NOT EXISTS idx_funding_program_matches_business
  ON public.funding_program_matches (business_id, is_new, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS public.funding_program_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  program_match_id UUID NOT NULL REFERENCES public.funding_program_matches(id) ON DELETE CASCADE,
  reminder_id UUID,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Default plan sections seed helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.funding_seed_plan_sections(p_plan_id UUID, p_business_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sections TEXT[][] := ARRAY[
    ARRAY['executive_summary', 'Executive Summary'],
    ARRAY['company_overview', 'Company Overview'],
    ARRAY['market_analysis', 'Market Analysis'],
    ARRAY['products_services', 'Products & Services'],
    ARRAY['marketing_sales', 'Marketing & Sales'],
    ARRAY['operations', 'Operations'],
    ARRAY['management_team', 'Management Team'],
    ARRAY['use_of_funds', 'Use of Funds'],
    ARRAY['financial_projections', 'Financial Projections'],
    ARRAY['risk_analysis', 'Risk Analysis'],
    ARRAY['appendices', 'Appendices']
  ];
  i INT;
BEGIN
  FOR i IN 1 .. array_length(sections, 1) LOOP
    INSERT INTO public.funding_plan_sections (
      business_id, plan_id, section_key, title, enabled, sort_order, content
    ) VALUES (
      p_business_id, p_plan_id, sections[i][1], sections[i][2], true, i, ''
    )
    ON CONFLICT (plan_id, section_key) DO NOTHING;
  END LOOP;
END;
$$;

-- Encrypt / decrypt helpers (pgcrypto pgp_sym_*, business-scoped key)
CREATE OR REPLACE FUNCTION public.funding_encrypt_field(p_plain TEXT, p_business_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key TEXT;
BEGIN
  IF p_plain IS NULL OR length(trim(p_plain)) = 0 THEN
    RAISE EXCEPTION 'Value cannot be empty';
  END IF;
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'Business ID is required';
  END IF;
  v_key := encode(digest(p_business_id::text || 'funding_encryption_salt_v1', 'sha256'), 'hex');
  RETURN encode(pgp_sym_encrypt(p_plain, v_key), 'base64');
END;
$$;

CREATE OR REPLACE FUNCTION public.funding_decrypt_field(p_cipher TEXT, p_business_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key TEXT;
BEGIN
  IF p_cipher IS NULL OR length(trim(p_cipher)) = 0 THEN
    RAISE EXCEPTION 'Encrypted data cannot be empty';
  END IF;
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'Business ID is required';
  END IF;
  IF NOT public.funding_is_business_owner(p_business_id) THEN
    RAISE EXCEPTION 'Not authorized to decrypt funding fields';
  END IF;
  v_key := encode(digest(p_business_id::text || 'funding_encryption_salt_v1', 'sha256'), 'hex');
  RETURN pgp_sym_decrypt(decode(p_cipher, 'base64'), v_key);
END;
$$;

-- Guest token validation (anon-safe)
CREATE OR REPLACE FUNCTION public.funding_validate_guest_token(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.funding_guest_tokens%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.funding_guest_tokens
  WHERE token = p_token
    AND revoked_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  UPDATE public.funding_guest_tokens
  SET last_used_at = now()
  WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'valid', true,
    'business_id', v_row.business_id,
    'collaborator_id', v_row.collaborator_id,
    'email', v_row.email,
    'access_level', v_row.access_level,
    'can_see_financials', v_row.can_see_financials,
    'plan_id', v_row.plan_id,
    'application_id', v_row.application_id,
    'expires_at', v_row.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.funding_get_guest_payload(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_access JSONB;
  v_plan JSONB;
  v_application JSONB;
BEGIN
  v_access := public.funding_validate_guest_token(p_token);
  IF COALESCE((v_access->>'valid')::boolean, false) = false THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  IF v_access ? 'plan_id' AND v_access->>'plan_id' IS NOT NULL THEN
    SELECT to_jsonb(p) || jsonb_build_object(
      'funding_plan_sections', COALESCE((
        SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_order)
        FROM public.funding_plan_sections s
        WHERE s.plan_id = (v_access->>'plan_id')::uuid
          AND s.enabled = true
      ), '[]'::jsonb)
    )
    INTO v_plan
    FROM public.funding_plans p
    WHERE p.id = (v_access->>'plan_id')::uuid
      AND p.business_id = (v_access->>'business_id')::uuid;
  END IF;

  IF v_access ? 'application_id' AND v_access->>'application_id' IS NOT NULL THEN
    SELECT to_jsonb(a)
    INTO v_application
    FROM public.funding_applications a
    WHERE a.id = (v_access->>'application_id')::uuid
      AND a.business_id = (v_access->>'business_id')::uuid;
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'access', v_access,
    'plan', v_plan,
    'application', v_application
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.funding_validate_guest_token(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.funding_get_guest_payload(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.funding_encrypt_field(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.funding_decrypt_field(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.funding_seed_plan_sections(UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.funding_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funding_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funding_plan_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funding_plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funding_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funding_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funding_application_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funding_funder_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funding_funder_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funding_application_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funding_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funding_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funding_guest_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funding_financial_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funding_sensitive_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funding_program_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funding_program_alerts ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'funding_settings',
    'funding_plans',
    'funding_plan_sections',
    'funding_plan_versions',
    'funding_scenarios',
    'funding_applications',
    'funding_application_links',
    'funding_funder_templates',
    'funding_funder_questions',
    'funding_application_answers',
    'funding_checklist_items',
    'funding_collaborators',
    'funding_guest_tokens',
    'funding_financial_snapshots',
    'funding_sensitive_fields',
    'funding_program_matches',
    'funding_program_alerts'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_select ON public.%I FOR SELECT TO authenticated USING (public.funding_is_business_member(business_id))',
      t, t
    );
    EXECUTE format('DROP POLICY IF EXISTS %I_insert ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.funding_is_business_owner(business_id) OR public.funding_is_business_member(business_id))',
      t, t
    );
    EXECUTE format('DROP POLICY IF EXISTS %I_update ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_update ON public.%I FOR UPDATE TO authenticated USING (public.funding_is_business_member(business_id)) WITH CHECK (public.funding_is_business_member(business_id))',
      t, t
    );
    EXECUTE format('DROP POLICY IF EXISTS %I_delete ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_delete ON public.%I FOR DELETE TO authenticated USING (public.funding_is_business_owner(business_id))',
      t, t
    );
  END LOOP;
END $$;
