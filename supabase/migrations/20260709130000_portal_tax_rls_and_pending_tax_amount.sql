-- Customer portal: allow tax table reads so checkout can calculate GST/PST.
-- Also store tax on pending Helcim rows for booking finalization.

ALTER TABLE public.booking_pending_helcim
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(10, 2);

COMMENT ON COLUMN public.booking_pending_helcim.tax_amount IS
  'Tax portion of order_total at checkout init (validated server-side).';

-- Shared predicate: business has an active booking activity (portal is in use).
CREATE OR REPLACE FUNCTION public.business_has_active_booking_activity(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.booking_activities ba
    WHERE ba.business_id = p_business_id
      AND ba.is_active = true
  );
$$;

-- pos_tax_categories
DROP POLICY IF EXISTS "anon_customer_portal_read_pos_tax_categories" ON public.pos_tax_categories;
CREATE POLICY "anon_customer_portal_read_pos_tax_categories"
  ON public.pos_tax_categories
  FOR SELECT
  TO anon
  USING (public.business_has_active_booking_activity(business_id));

DROP POLICY IF EXISTS "authenticated_customer_portal_read_pos_tax_categories" ON public.pos_tax_categories;
CREATE POLICY "authenticated_customer_portal_read_pos_tax_categories"
  ON public.pos_tax_categories
  FOR SELECT
  TO authenticated
  USING (public.business_has_active_booking_activity(business_id));

-- pos_category_tax_assignments
DROP POLICY IF EXISTS "anon_customer_portal_read_pos_category_tax_assignments" ON public.pos_category_tax_assignments;
CREATE POLICY "anon_customer_portal_read_pos_category_tax_assignments"
  ON public.pos_category_tax_assignments
  FOR SELECT
  TO anon
  USING (public.business_has_active_booking_activity(business_id));

DROP POLICY IF EXISTS "authenticated_customer_portal_read_pos_category_tax_assignments" ON public.pos_category_tax_assignments;
CREATE POLICY "authenticated_customer_portal_read_pos_category_tax_assignments"
  ON public.pos_category_tax_assignments
  FOR SELECT
  TO authenticated
  USING (public.business_has_active_booking_activity(business_id));

-- pos_categories (used by useTaxCalculations in portal checkout)
DROP POLICY IF EXISTS "anon_customer_portal_read_pos_categories" ON public.pos_categories;
CREATE POLICY "anon_customer_portal_read_pos_categories"
  ON public.pos_categories
  FOR SELECT
  TO anon
  USING (public.business_has_active_booking_activity(business_id));

DROP POLICY IF EXISTS "authenticated_customer_portal_read_pos_categories" ON public.pos_categories;
CREATE POLICY "authenticated_customer_portal_read_pos_categories"
  ON public.pos_categories
  FOR SELECT
  TO authenticated
  USING (public.business_has_active_booking_activity(business_id));
