-- Fast aggregates for POS Customers dashboard (avoids loading every loyalty row for totals / stats).

CREATE OR REPLACE FUNCTION public.pos_loyalty_accounts_dashboard_aggregates(
  p_business_id uuid,
  p_include_balance_in_points boolean DEFAULT true,
  p_redemption_rate integer DEFAULT 10000
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'account_count',
    (SELECT count(*)::bigint FROM public.pos_loyalty_accounts pl WHERE pl.business_id = p_business_id),
    'sum_balance',
    (SELECT coalesce(sum(pl.balance::numeric), 0) FROM public.pos_loyalty_accounts pl WHERE pl.business_id = p_business_id),
    'sum_raw_points',
    (SELECT coalesce(sum(coalesce(pl.points, 0::numeric)), 0) FROM public.pos_loyalty_accounts pl WHERE pl.business_id = p_business_id),
    'sum_display_points',
    (
      SELECT coalesce(
        sum(
          coalesce(pl.points, 0)::numeric
          + case
              when p_include_balance_in_points
                then round(coalesce(pl.balance, 0) * (p_redemption_rate::numeric / 10.0))
              else 0
            end
        ),
        0
      )
      FROM public.pos_loyalty_accounts pl
      WHERE pl.business_id = p_business_id
    )
  );
$$;

COMMENT ON FUNCTION public.pos_loyalty_accounts_dashboard_aggregates(uuid, boolean, integer) IS
  'Aggregates for POS customers dashboard. sum_display_points matches POS “points mode” (points + balance×rate/10) when p_include_balance_in_points is true.';

GRANT EXECUTE ON FUNCTION public.pos_loyalty_accounts_dashboard_aggregates(uuid, boolean, integer) TO authenticated;
