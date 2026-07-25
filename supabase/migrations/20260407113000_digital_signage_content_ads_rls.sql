-- Align digital signage RLS with app access rules.
-- Allows authenticated business members via either business_users or active user_roles.

CREATE OR REPLACE FUNCTION public.is_digital_signage_business_member(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.business_id = p_business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('owner', 'manager', 'employee', 'admin')
  )
  OR EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.business_id = p_business_id
      AND ur.user_id = auth.uid()
      AND ur.active = true
      AND ur.role IN ('owner', 'manager', 'employee', 'admin')
  );
$$;

ALTER TABLE public.digital_signage_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digital_signage_ads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated business access" ON public.digital_signage_content;
DROP POLICY IF EXISTS "digital_signage_content_select" ON public.digital_signage_content;
DROP POLICY IF EXISTS "digital_signage_content_insert" ON public.digital_signage_content;
DROP POLICY IF EXISTS "digital_signage_content_update" ON public.digital_signage_content;
DROP POLICY IF EXISTS "digital_signage_content_delete" ON public.digital_signage_content;

CREATE POLICY "digital_signage_content_select"
  ON public.digital_signage_content
  FOR SELECT
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id));

CREATE POLICY "digital_signage_content_insert"
  ON public.digital_signage_content
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_digital_signage_business_member(business_id));

CREATE POLICY "digital_signage_content_update"
  ON public.digital_signage_content
  FOR UPDATE
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id))
  WITH CHECK (public.is_digital_signage_business_member(business_id));

CREATE POLICY "digital_signage_content_delete"
  ON public.digital_signage_content
  FOR DELETE
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id));

DROP POLICY IF EXISTS "Authenticated business access" ON public.digital_signage_ads;
DROP POLICY IF EXISTS "digital_signage_ads_select" ON public.digital_signage_ads;
DROP POLICY IF EXISTS "digital_signage_ads_insert" ON public.digital_signage_ads;
DROP POLICY IF EXISTS "digital_signage_ads_update" ON public.digital_signage_ads;
DROP POLICY IF EXISTS "digital_signage_ads_delete" ON public.digital_signage_ads;

CREATE POLICY "digital_signage_ads_select"
  ON public.digital_signage_ads
  FOR SELECT
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id));

CREATE POLICY "digital_signage_ads_insert"
  ON public.digital_signage_ads
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_digital_signage_business_member(business_id));

CREATE POLICY "digital_signage_ads_update"
  ON public.digital_signage_ads
  FOR UPDATE
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id))
  WITH CHECK (public.is_digital_signage_business_member(business_id));

CREATE POLICY "digital_signage_ads_delete"
  ON public.digital_signage_ads
  FOR DELETE
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id));
