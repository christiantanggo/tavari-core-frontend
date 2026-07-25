-- get_customer_display_state must be VOLATILE: it reads pos_customer_display_mirror, which changes from other sessions.
-- STABLE was incorrect and can allow misleading query planner / caching assumptions for live mirror polling.

CREATE OR REPLACE FUNCTION public.get_customer_display_state (p_token uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    jsonb_build_object(
      'business_id', m.business_id,
      'payload', COALESCE(m.payload, '{}'::jsonb),
      'updated_at', m.updated_at
    )
  FROM public.pos_customer_display_mirror m
  WHERE m.read_token = p_token
  LIMIT 1;
$$;
