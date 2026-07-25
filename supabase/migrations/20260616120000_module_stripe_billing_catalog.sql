-- Module Stripe billing catalog (CAD, monthly) + per-business seat access + Stripe line item map.
-- billing_included_seats: -1 = unlimited (all seat charges waived; quantity sent to Stripe = 0).

ALTER TABLE public.app_modules
  ADD COLUMN IF NOT EXISTS billing_base_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billing_seat_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billing_included_seats integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stripe_product_id text,
  ADD COLUMN IF NOT EXISTS stripe_base_price_id text,
  ADD COLUMN IF NOT EXISTS stripe_seat_price_id text;

COMMENT ON COLUMN public.app_modules.billing_base_cents IS 'Monthly module base price in cents (CAD).';
COMMENT ON COLUMN public.app_modules.billing_seat_cents IS 'Monthly per-seat price in cents (CAD); may be 0.';
COMMENT ON COLUMN public.app_modules.billing_included_seats IS 'Seats included before per-seat billing; -1 = unlimited (billable seats forced to 0).';

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

CREATE TABLE IF NOT EXISTS public.business_module_user_access (
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  module_key text NOT NULL REFERENCES public.app_modules (module_key) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, module_key, user_id)
);

CREATE INDEX IF NOT EXISTS idx_business_module_user_access_business_module
  ON public.business_module_user_access (business_id, module_key);

CREATE TABLE IF NOT EXISTS public.business_module_stripe_items (
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  module_key text NOT NULL REFERENCES public.app_modules (module_key) ON DELETE CASCADE,
  stripe_subscription_item_base_id text,
  stripe_subscription_item_seat_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, module_key)
);

ALTER TABLE public.business_module_user_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_module_stripe_items ENABLE ROW LEVEL SECURITY;

-- Catalog updates from Tavari admin (matches open TOSA patterns used elsewhere).
DROP POLICY IF EXISTS "app_modules_tosa_update" ON public.app_modules;
CREATE POLICY "app_modules_tosa_update"
ON public.app_modules FOR UPDATE
TO public
USING (true)
WITH CHECK (true);

-- business_module_user_access: business staff + Tavari internal staff.
DROP POLICY IF EXISTS "business_module_user_access_select" ON public.business_module_user_access;
CREATE POLICY "business_module_user_access_select"
ON public.business_module_user_access FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.tavari_employees te
    WHERE te.user_id = auth.uid() AND te.is_active = true
  )
  OR business_id IN (
    SELECT ur.business_id FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin', 'manager')
      AND ur.active = true
  )
  OR business_id IN (
    SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
  )
  OR business_id IN (
    SELECT bu.business_id FROM public.business_users bu
    INNER JOIN public.users u ON u.id = bu.user_id
    WHERE lower(trim(coalesce(u.email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
      AND coalesce(auth.jwt() ->> 'email', '') <> ''
  )
);

DROP POLICY IF EXISTS "business_module_user_access_write_managers" ON public.business_module_user_access;
CREATE POLICY "business_module_user_access_write_managers"
ON public.business_module_user_access FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.tavari_employees te
    WHERE te.user_id = auth.uid() AND te.is_active = true
  )
  OR business_id IN (
    SELECT ur.business_id FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin', 'manager')
      AND ur.active = true
  )
);

DROP POLICY IF EXISTS "business_module_user_access_delete_managers" ON public.business_module_user_access;
CREATE POLICY "business_module_user_access_delete_managers"
ON public.business_module_user_access FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.tavari_employees te
    WHERE te.user_id = auth.uid() AND te.is_active = true
  )
  OR business_id IN (
    SELECT ur.business_id FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin', 'manager')
      AND ur.active = true
  )
);

-- Stripe item ids: readable by same cohort as access list; writes via Edge (service role) only.
DROP POLICY IF EXISTS "business_module_stripe_items_select" ON public.business_module_stripe_items;
CREATE POLICY "business_module_stripe_items_select"
ON public.business_module_stripe_items FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.tavari_employees te
    WHERE te.user_id = auth.uid() AND te.is_active = true
  )
  OR business_id IN (
    SELECT ur.business_id FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin', 'manager')
      AND ur.active = true
  )
);

GRANT SELECT ON public.business_module_stripe_items TO authenticated, anon;
GRANT SELECT, INSERT, DELETE ON public.business_module_user_access TO authenticated, anon;
GRANT UPDATE (billing_base_cents, billing_seat_cents, billing_included_seats, stripe_product_id, stripe_base_price_id, stripe_seat_price_id) ON public.app_modules TO authenticated, anon;

-- Tavari internal staff may manage seat assignments for any business (TOSA / support tooling).
DROP POLICY IF EXISTS "tavari_staff_business_module_user_access_all" ON public.business_module_user_access;
CREATE POLICY "tavari_staff_business_module_user_access_all"
ON public.business_module_user_access FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.tavari_employees te
    WHERE te.user_id = auth.uid() AND te.is_active = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.tavari_employees te
    WHERE te.user_id = auth.uid() AND te.is_active = true
  )
);
