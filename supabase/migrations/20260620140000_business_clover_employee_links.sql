-- Maps Clover register employees to Tavari users for PIN parity and staff sync.

CREATE TABLE IF NOT EXISTS public.business_clover_employee_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  clover_employee_id TEXT NOT NULL,
  user_id UUID REFERENCES public.users (id) ON DELETE SET NULL,
  clover_role TEXT,
  employee_name TEXT,
  employee_email TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT business_clover_employee_links_business_clover_key
    UNIQUE (business_id, clover_employee_id)
);

CREATE INDEX IF NOT EXISTS idx_business_clover_employee_links_user
  ON public.business_clover_employee_links (business_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.update_business_clover_employee_links_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_business_clover_employee_links_updated
  ON public.business_clover_employee_links;
CREATE TRIGGER trg_business_clover_employee_links_updated
  BEFORE UPDATE ON public.business_clover_employee_links
  FOR EACH ROW
  EXECUTE FUNCTION public.update_business_clover_employee_links_updated_at();

ALTER TABLE public.business_clover_employee_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.business_clover_employee_links FROM PUBLIC;
REVOKE ALL ON public.business_clover_employee_links FROM anon;
REVOKE ALL ON public.business_clover_employee_links FROM authenticated;
GRANT ALL ON public.business_clover_employee_links TO service_role;

COMMENT ON TABLE public.business_clover_employee_links IS
  'Clover App Market waiver app: Clover employee id ↔ Tavari user per business.';
