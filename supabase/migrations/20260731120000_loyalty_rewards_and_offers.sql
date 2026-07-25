-- Item bonus points (Rewards tab catalog) + personalized loyalty offer rules.

ALTER TABLE public.pos_inventory
  ADD COLUMN IF NOT EXISTS show_on_rewards_tab boolean NOT NULL DEFAULT false;

ALTER TABLE public.pos_inventory
  ADD COLUMN IF NOT EXISTS loyalty_rewards_blurb text;

COMMENT ON COLUMN public.pos_inventory.loyalty_points_earned IS
  'Extra loyalty points awarded per unit when this item is purchased (on top of global earn rate).';

COMMENT ON COLUMN public.pos_inventory.show_on_rewards_tab IS
  'When true, item appears in customer app Rewards tab as an earn opportunity.';

COMMENT ON COLUMN public.pos_inventory.loyalty_rewards_blurb IS
  'Short marketing copy shown on the Rewards tab for this item.';

CREATE TABLE IF NOT EXISTS public.loyalty_offer_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  trigger_type text NOT NULL,
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  reward_type text NOT NULL,
  reward_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  offer_valid_days integer NOT NULL DEFAULT 14,
  max_active_per_customer integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loyalty_offer_rules_trigger_type_check CHECK (
    trigger_type IN (
      'inactive_days',
      'never_purchased_category',
      'never_purchased_inventory',
      'has_category_not_category',
      'never_booked_activity'
    )
  ),
  CONSTRAINT loyalty_offer_rules_reward_type_check CHECK (
    reward_type IN ('bonus_points', 'percent_discount', 'fixed_discount')
  )
);

CREATE INDEX IF NOT EXISTS idx_loyalty_offer_rules_business_active
  ON public.loyalty_offer_rules (business_id, is_active, priority);

CREATE TABLE IF NOT EXISTS public.customer_loyalty_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.pos_loyalty_accounts(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES public.loyalty_offer_rules(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  reward_type text NOT NULL,
  reward_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT customer_loyalty_offers_status_check CHECK (
    status IN ('active', 'redeemed', 'expired', 'dismissed')
  )
);

CREATE INDEX IF NOT EXISTS idx_customer_loyalty_offers_customer_active
  ON public.customer_loyalty_offers (business_id, customer_id, status, expires_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_loyalty_offers_active_rule
  ON public.customer_loyalty_offers (business_id, customer_id, rule_id)
  WHERE status = 'active' AND rule_id IS NOT NULL;

ALTER TABLE public.loyalty_offer_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_loyalty_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS loyalty_offer_rules_business ON public.loyalty_offer_rules;
CREATE POLICY loyalty_offer_rules_business ON public.loyalty_offer_rules
  FOR ALL USING (
    business_id IN (
      SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS customer_loyalty_offers_business ON public.customer_loyalty_offers;
CREATE POLICY customer_loyalty_offers_business ON public.customer_loyalty_offers
  FOR ALL USING (
    business_id IN (
      SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.loyalty_offer_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_loyalty_offers TO authenticated;
