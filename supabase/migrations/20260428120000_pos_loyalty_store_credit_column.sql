-- Separate account **money** (`store_credit`) from loyalty **points** (`points`) and legacy pool (`balance` in dollars mode).

ALTER TABLE public.pos_loyalty_accounts
  ADD COLUMN IF NOT EXISTS store_credit numeric(14, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.pos_loyalty_accounts.store_credit IS
  'Spendable dollar credit (deposits, refunds, goodwill) — not loyalty program points.';

-- Dashboard aggregates: total points = sum(points) only; store credit = sum(store_credit);
-- p_include_balance_in_points is kept for API compatibility but no longer adds balance into "display points".
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
    'sum_store_credit',
    (SELECT coalesce(sum(coalesce(pl.store_credit, 0::numeric)), 0) FROM public.pos_loyalty_accounts pl WHERE pl.business_id = p_business_id),
    'sum_raw_points',
    (SELECT coalesce(sum(coalesce(pl.points, 0::numeric)), 0) FROM public.pos_loyalty_accounts pl WHERE pl.business_id = p_business_id),
    'sum_display_points',
    (SELECT coalesce(sum(coalesce(pl.points, 0::numeric)), 0) FROM public.pos_loyalty_accounts pl WHERE pl.business_id = p_business_id)
  );
$$;

COMMENT ON FUNCTION public.pos_loyalty_accounts_dashboard_aggregates(uuid, boolean, integer) IS
  'Aggregates for POS customers. sum_store_credit = total account money; sum_display_points = total loyalty points (raw points column).';
