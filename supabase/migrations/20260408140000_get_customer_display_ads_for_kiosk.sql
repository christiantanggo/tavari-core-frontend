-- Paired customer display (Electron / browser with displayToken) uses the anon Supabase key.
-- RLS on customer_display_ads only allows SELECT for business_users with auth.uid(), so direct
-- .from('customer_display_ads') returns zero rows and the kiosk shows the empty "Welcome" state.
-- This RPC uses the same read_token → business linkage as get_customer_display_state.

CREATE OR REPLACE FUNCTION public.get_customer_display_ads_for_kiosk (p_token uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.display_order NULLS LAST, a.created_at NULLS LAST)
      FROM public.customer_display_ads a
      INNER JOIN public.pos_customer_display_mirror m ON m.business_id = a.business_id
      WHERE m.read_token = p_token
        AND a.is_active = true
    ),
    '[]'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.get_customer_display_ads_for_kiosk (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_display_ads_for_kiosk (uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_customer_display_ads_for_kiosk (uuid) TO authenticated;

COMMENT ON FUNCTION public.get_customer_display_ads_for_kiosk (uuid) IS 'Active customer_display_ads for the business tied to pos_customer_display_mirror.read_token; for paired kiosk without staff JWT.';
