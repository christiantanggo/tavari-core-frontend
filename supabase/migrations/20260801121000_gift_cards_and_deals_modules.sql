-- Gift Cards + Deals & Coupons modules
-- Money gift cards (liability, Ontario no-expiry default) + marketing deals/coupons (can expire)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO public.app_modules (module_key, module_name, description, icon, enabled_by_default, module_category)
VALUES
  (
    'gift_cards',
    'Gift Cards',
    'Sell and redeem digital gift cards and prepaid item vouchers across POS, booking, portals, and the customer app.',
    'FiGift',
    false,
    'Sales'
  ),
  (
    'deals',
    'Deals & Coupons',
    'Create website deals, printable coupons, bundles, and promotional vouchers that are not prepaid gift cards.',
    'FiTag',
    false,
    'Marketing'
  )
ON CONFLICT (module_key) DO UPDATE SET
  module_name = EXCLUDED.module_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  module_category = EXCLUDED.module_category;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gift_cards_is_business_member(p_business_id UUID)
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

CREATE OR REPLACE FUNCTION public.gift_cards_is_business_owner(p_business_id UUID)
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

CREATE OR REPLACE FUNCTION public.deals_is_business_member(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.gift_cards_is_business_member(p_business_id);
$$;

CREATE OR REPLACE FUNCTION public.deals_is_business_owner(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.gift_cards_is_business_owner(p_business_id);
$$;

CREATE OR REPLACE FUNCTION public.gift_cards_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Customer residual gift credit (separate from store_credit)
ALTER TABLE public.pos_loyalty_accounts
  ADD COLUMN IF NOT EXISTS gift_card_credit NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.accounting_business_config
  ADD COLUMN IF NOT EXISTS gift_card_liability_account_erpnext TEXT,
  ADD COLUMN IF NOT EXISTS gift_card_promo_expense_account_erpnext TEXT;

-- ---------------------------------------------------------------------------
-- Gift card settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gift_card_settings (
  business_id UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  allow_custom_amount BOOLEAN NOT NULL DEFAULT true,
  min_custom_amount NUMERIC(12, 2) NOT NULL DEFAULT 5,
  max_custom_amount NUMERIC(12, 2) NOT NULL DEFAULT 1000,
  never_expire_money_cards BOOLEAN NOT NULL DEFAULT true,
  default_expiry_days INT,
  allow_cross_business BOOLEAN NOT NULL DEFAULT false,
  notify_recipient_default BOOLEAN NOT NULL DEFAULT true,
  tax_at_redemption_only BOOLEAN NOT NULL DEFAULT true,
  default_design_id UUID,
  pos_category_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_gift_card_settings_updated_at ON public.gift_card_settings;
CREATE TRIGGER trg_gift_card_settings_updated_at
  BEFORE UPDATE ON public.gift_card_settings
  FOR EACH ROW EXECUTE FUNCTION public.gift_cards_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Designs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gift_card_designs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  uses_business_logo BOOLEAN NOT NULL DEFAULT true,
  background_color TEXT NOT NULL DEFAULT '#0f766e',
  text_color TEXT NOT NULL DEFAULT '#ffffff',
  accent_color TEXT NOT NULL DEFAULT '#14b8a6',
  custom_image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gift_card_designs_business
  ON public.gift_card_designs (business_id, is_default DESC);

DROP TRIGGER IF EXISTS trg_gift_card_designs_updated_at ON public.gift_card_designs;
CREATE TRIGGER trg_gift_card_designs_updated_at
  BEFORE UPDATE ON public.gift_card_designs
  FOR EACH ROW EXECUTE FUNCTION public.gift_cards_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Products (denominations + item vouchers)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gift_card_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_type TEXT NOT NULL DEFAULT 'money'
    CHECK (product_type IN ('money', 'item')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  face_value NUMERIC(12, 2),
  sale_price NUMERIC(12, 2),
  inventory_item_id UUID,
  inventory_qty INT NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  allow_expiry BOOLEAN NOT NULL DEFAULT false,
  default_expiry_days INT,
  sort_order INT NOT NULL DEFAULT 0,
  pos_product_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gift_card_products_business
  ON public.gift_card_products (business_id, is_active, sort_order);

DROP TRIGGER IF EXISTS trg_gift_card_products_updated_at ON public.gift_card_products;
CREATE TRIGGER trg_gift_card_products_updated_at
  BEFORE UPDATE ON public.gift_card_products
  FOR EACH ROW EXECUTE FUNCTION public.gift_cards_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Cards
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gift_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  issuing_business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.gift_card_products(id) ON DELETE SET NULL,
  design_id UUID REFERENCES public.gift_card_designs(id) ON DELETE SET NULL,
  card_type TEXT NOT NULL DEFAULT 'money'
    CHECK (card_type IN ('money', 'item')),
  code TEXT NOT NULL,
  code_normalized TEXT NOT NULL,
  qr_payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'partially_redeemed', 'redeemed', 'voided', 'replaced', 'expired')),
  face_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
  balance_remaining NUMERIC(12, 2) NOT NULL DEFAULT 0,
  inventory_item_id UUID,
  inventory_qty_remaining INT NOT NULL DEFAULT 0,
  purchaser_customer_id UUID REFERENCES public.pos_loyalty_accounts(id) ON DELETE SET NULL,
  recipient_customer_id UUID REFERENCES public.pos_loyalty_accounts(id) ON DELETE SET NULL,
  redeemer_customer_id UUID REFERENCES public.pos_loyalty_accounts(id) ON DELETE SET NULL,
  purchaser_name TEXT,
  purchaser_email TEXT,
  purchaser_phone TEXT,
  recipient_name TEXT,
  recipient_email TEXT,
  recipient_phone TEXT,
  notify_recipient BOOLEAN NOT NULL DEFAULT false,
  is_charitable BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ,
  first_redeemed_at TIMESTAMPTZ,
  replaced_by_card_id UUID REFERENCES public.gift_cards(id) ON DELETE SET NULL,
  replaces_card_id UUID REFERENCES public.gift_cards(id) ON DELETE SET NULL,
  invalid_reason TEXT,
  sale_source TEXT NOT NULL DEFAULT 'pos'
    CHECK (sale_source IN ('pos', 'booking', 'portal', 'app', 'staff', 'promo', 'charity', 'other')),
  sale_sale_id UUID,
  sale_booking_id UUID,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, code_normalized)
);

CREATE INDEX IF NOT EXISTS idx_gift_cards_business_status
  ON public.gift_cards (business_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gift_cards_code
  ON public.gift_cards (code_normalized);
CREATE INDEX IF NOT EXISTS idx_gift_cards_purchaser
  ON public.gift_cards (purchaser_customer_id);
CREATE INDEX IF NOT EXISTS idx_gift_cards_redeemer
  ON public.gift_cards (redeemer_customer_id);

DROP TRIGGER IF EXISTS trg_gift_cards_updated_at ON public.gift_cards;
CREATE TRIGGER trg_gift_cards_updated_at
  BEFORE UPDATE ON public.gift_cards
  FOR EACH ROW EXECUTE FUNCTION public.gift_cards_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Ledger / audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gift_card_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  gift_card_id UUID REFERENCES public.gift_cards(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.pos_loyalty_accounts(id) ON DELETE SET NULL,
  transaction_type TEXT NOT NULL
    CHECK (transaction_type IN (
      'issue', 'redeem', 'attach_residual', 'gift_credit_spend', 'gift_credit_bonus',
      'adjust', 'void', 'reprint', 'expire', 'promo_bonus', 'settlement'
    )),
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  balance_before NUMERIC(12, 2),
  balance_after NUMERIC(12, 2),
  inventory_qty_before INT,
  inventory_qty_after INT,
  redeeming_business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
  sale_id UUID,
  booking_id UUID,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gift_card_tx_business
  ON public.gift_card_transactions (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gift_card_tx_card
  ON public.gift_card_transactions (gift_card_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gift_card_tx_customer
  ON public.gift_card_transactions (customer_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Cross-business network
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gift_card_business_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer_business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  partner_business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  responded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  settlement_fee_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (issuer_business_id, partner_business_id)
);

CREATE INDEX IF NOT EXISTS idx_gift_card_links_partner
  ON public.gift_card_business_links (partner_business_id, status);

DROP TRIGGER IF EXISTS trg_gift_card_links_updated_at ON public.gift_card_business_links;
CREATE TRIGGER trg_gift_card_links_updated_at
  BEFORE UPDATE ON public.gift_card_business_links
  FOR EACH ROW EXECUTE FUNCTION public.gift_cards_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.gift_card_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer_business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  redeemer_business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  gift_card_transaction_id UUID REFERENCES public.gift_card_transactions(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL,
  fee_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(12, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'paid', 'voided')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gift_card_settlements_parties
  ON public.gift_card_settlements (issuer_business_id, redeemer_business_id, status);

DROP TRIGGER IF EXISTS trg_gift_card_settlements_updated_at ON public.gift_card_settlements;
CREATE TRIGGER trg_gift_card_settlements_updated_at
  BEFORE UPDATE ON public.gift_card_settlements
  FOR EACH ROW EXECUTE FUNCTION public.gift_cards_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Promotions / burn campaigns (gift-card specific)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gift_card_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  promo_type TEXT NOT NULL
    CHECK (promo_type IN (
      'price_override', 'percent_off', 'bonus_face_value', 'bogo_multi',
      'item_gets_gift_card', 'gift_card_gets_item', 'first_n', 'burn_bonus'
    )),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'active', 'ended', 'cancelled')),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_n_limit INT,
  redemption_count INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gift_card_promos_business
  ON public.gift_card_promotions (business_id, status, starts_at);

DROP TRIGGER IF EXISTS trg_gift_card_promos_updated_at ON public.gift_card_promotions;
CREATE TRIGGER trg_gift_card_promos_updated_at
  BEFORE UPDATE ON public.gift_card_promotions
  FOR EACH ROW EXECUTE FUNCTION public.gift_cards_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Deals & Coupons
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_settings (
  business_id UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  show_on_booking_portal BOOLEAN NOT NULL DEFAULT true,
  show_on_customer_portal BOOLEAN NOT NULL DEFAULT true,
  show_on_customer_app BOOLEAN NOT NULL DEFAULT true,
  show_on_website BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_deal_settings_updated_at ON public.deal_settings;
CREATE TRIGGER trg_deal_settings_updated_at
  BEFORE UPDATE ON public.deal_settings
  FOR EACH ROW EXECUTE FUNCTION public.gift_cards_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  deal_type TEXT NOT NULL
    CHECK (deal_type IN (
      'percent_off', 'amount_off', 'bundle', 'bogo', 'free_item_voucher',
      'buy_x_get_y', 'fixed_price_bundle'
    )),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'active', 'ended', 'cancelled')),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  code TEXT,
  code_normalized TEXT,
  is_printable BOOLEAN NOT NULL DEFAULT true,
  show_on_deals_page BOOLEAN NOT NULL DEFAULT true,
  first_n_limit INT,
  redemption_count INT NOT NULL DEFAULT 0,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  inventory_item_id UUID,
  inventory_qty INT NOT NULL DEFAULT 1,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deals_business
  ON public.deals (business_id, status, starts_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_code_unique
  ON public.deals (business_id, code_normalized)
  WHERE code_normalized IS NOT NULL;

DROP TRIGGER IF EXISTS trg_deals_updated_at ON public.deals;
CREATE TRIGGER trg_deals_updated_at
  BEFORE UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.gift_cards_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.deal_vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  code_normalized TEXT NOT NULL,
  qr_payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'redeemed', 'voided', 'expired', 'replaced')),
  expires_at TIMESTAMPTZ,
  customer_id UUID REFERENCES public.pos_loyalty_accounts(id) ON DELETE SET NULL,
  redeemed_at TIMESTAMPTZ,
  redeemed_sale_id UUID,
  invalid_reason TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, code_normalized)
);

CREATE INDEX IF NOT EXISTS idx_deal_vouchers_business
  ON public.deal_vouchers (business_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_deal_vouchers_updated_at ON public.deal_vouchers;
CREATE TRIGGER trg_deal_vouchers_updated_at
  BEFORE UPDATE ON public.deal_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.gift_cards_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.deal_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  voucher_id UUID REFERENCES public.deal_vouchers(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.pos_loyalty_accounts(id) ON DELETE SET NULL,
  sale_id UUID,
  booking_id UUID,
  discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_redemptions_business
  ON public.deal_redemptions (business_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Code helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gift_cards_normalize_code(p_code TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.gift_cards_generate_code(p_prefix TEXT DEFAULT 'GC')
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  alphabet TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out TEXT := '';
  i INT;
BEGIN
  out := upper(coalesce(nullif(trim(p_prefix), ''), 'GC'));
  FOR i IN 1..10 LOOP
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  END LOOP;
  RETURN out;
END;
$$;

-- ---------------------------------------------------------------------------
-- Ensure POS "Gift Cards" category when module enabled
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gift_cards_ensure_pos_category(p_business_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cat_id UUID;
  v_max_sort INT;
BEGIN
  SELECT id INTO v_cat_id
  FROM public.pos_categories
  WHERE business_id = p_business_id
    AND lower(name) = 'gift cards'
  LIMIT 1;

  IF v_cat_id IS NOT NULL THEN
    INSERT INTO public.gift_card_settings (business_id, pos_category_id)
    VALUES (p_business_id, v_cat_id)
    ON CONFLICT (business_id) DO UPDATE
      SET pos_category_id = COALESCE(public.gift_card_settings.pos_category_id, EXCLUDED.pos_category_id),
          updated_at = now();
    RETURN v_cat_id;
  END IF;

  SELECT COALESCE(MAX(sort_order), 0) INTO v_max_sort
  FROM public.pos_categories
  WHERE business_id = p_business_id;

  INSERT INTO public.pos_categories (name, business_id, color, emoji, sort_order, category_type)
  VALUES ('Gift Cards', p_business_id, '#0f766e', '🎁', v_max_sort + 1, 'pos_only')
  RETURNING id INTO v_cat_id;

  INSERT INTO public.gift_card_settings (business_id, pos_category_id)
  VALUES (p_business_id, v_cat_id)
  ON CONFLICT (business_id) DO UPDATE
    SET pos_category_id = EXCLUDED.pos_category_id,
        updated_at = now();

  RETURN v_cat_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.gift_cards_ensure_pos_category(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gift_cards_normalize_code(TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.gift_cards_generate_code(TEXT) TO authenticated;

-- Seed default settings + design when module is turned on (also safe to call anytime)
CREATE OR REPLACE FUNCTION public.gift_cards_bootstrap_business(p_business_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_design_id UUID;
BEGIN
  PERFORM public.gift_cards_ensure_pos_category(p_business_id);

  INSERT INTO public.gift_card_settings (business_id)
  VALUES (p_business_id)
  ON CONFLICT (business_id) DO NOTHING;

  SELECT id INTO v_design_id
  FROM public.gift_card_designs
  WHERE business_id = p_business_id AND is_default = true
  LIMIT 1;

  IF v_design_id IS NULL THEN
    INSERT INTO public.gift_card_designs (
      business_id, name, is_default, uses_business_logo,
      background_color, text_color, accent_color
    ) VALUES (
      p_business_id, 'Default', true, true,
      '#0f766e', '#ffffff', '#14b8a6'
    )
    RETURNING id INTO v_design_id;

    UPDATE public.gift_card_settings
    SET default_design_id = v_design_id, updated_at = now()
    WHERE business_id = p_business_id;
  END IF;

  -- Default denominations
  IF NOT EXISTS (
    SELECT 1 FROM public.gift_card_products WHERE business_id = p_business_id
  ) THEN
    INSERT INTO public.gift_card_products (
      business_id, product_type, name, face_value, sale_price, sort_order
    ) VALUES
      (p_business_id, 'money', '$25 Gift Card', 25, 25, 1),
      (p_business_id, 'money', '$50 Gift Card', 50, 50, 2),
      (p_business_id, 'money', '$100 Gift Card', 100, 100, 3);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.gift_cards_bootstrap_business(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.deals_bootstrap_business(p_business_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.deal_settings (business_id)
  VALUES (p_business_id)
  ON CONFLICT (business_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.deals_bootstrap_business(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.gift_card_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_card_designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_card_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_card_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_card_business_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_card_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_card_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_redemptions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'gift_card_settings',
    'gift_card_designs',
    'gift_card_products',
    'gift_cards',
    'gift_card_transactions',
    'gift_card_promotions',
    'deal_settings',
    'deals',
    'deal_vouchers',
    'deal_redemptions'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_select ON public.%I FOR SELECT TO authenticated USING (public.gift_cards_is_business_member(business_id))',
      t, t
    );
    EXECUTE format('DROP POLICY IF EXISTS %I_insert ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.gift_cards_is_business_member(business_id))',
      t, t
    );
    EXECUTE format('DROP POLICY IF EXISTS %I_update ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_update ON public.%I FOR UPDATE TO authenticated USING (public.gift_cards_is_business_member(business_id)) WITH CHECK (public.gift_cards_is_business_member(business_id))',
      t, t
    );
    EXECUTE format('DROP POLICY IF EXISTS %I_delete ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_delete ON public.%I FOR DELETE TO authenticated USING (public.gift_cards_is_business_owner(business_id))',
      t, t
    );
  END LOOP;
END $$;

-- Cross-business links: member of issuer OR partner can see
DROP POLICY IF EXISTS gift_card_business_links_select ON public.gift_card_business_links;
CREATE POLICY gift_card_business_links_select ON public.gift_card_business_links
  FOR SELECT TO authenticated
  USING (
    public.gift_cards_is_business_member(issuer_business_id)
    OR public.gift_cards_is_business_member(partner_business_id)
  );

DROP POLICY IF EXISTS gift_card_business_links_insert ON public.gift_card_business_links;
CREATE POLICY gift_card_business_links_insert ON public.gift_card_business_links
  FOR INSERT TO authenticated
  WITH CHECK (public.gift_cards_is_business_member(issuer_business_id));

DROP POLICY IF EXISTS gift_card_business_links_update ON public.gift_card_business_links;
CREATE POLICY gift_card_business_links_update ON public.gift_card_business_links
  FOR UPDATE TO authenticated
  USING (
    public.gift_cards_is_business_member(issuer_business_id)
    OR public.gift_cards_is_business_member(partner_business_id)
  )
  WITH CHECK (
    public.gift_cards_is_business_member(issuer_business_id)
    OR public.gift_cards_is_business_member(partner_business_id)
  );

DROP POLICY IF EXISTS gift_card_business_links_delete ON public.gift_card_business_links;
CREATE POLICY gift_card_business_links_delete ON public.gift_card_business_links
  FOR DELETE TO authenticated
  USING (public.gift_cards_is_business_owner(issuer_business_id));

DROP POLICY IF EXISTS gift_card_settlements_select ON public.gift_card_settlements;
CREATE POLICY gift_card_settlements_select ON public.gift_card_settlements
  FOR SELECT TO authenticated
  USING (
    public.gift_cards_is_business_member(issuer_business_id)
    OR public.gift_cards_is_business_member(redeemer_business_id)
  );

DROP POLICY IF EXISTS gift_card_settlements_insert ON public.gift_card_settlements;
CREATE POLICY gift_card_settlements_insert ON public.gift_card_settlements
  FOR INSERT TO authenticated
  WITH CHECK (
    public.gift_cards_is_business_member(issuer_business_id)
    OR public.gift_cards_is_business_member(redeemer_business_id)
  );

DROP POLICY IF EXISTS gift_card_settlements_update ON public.gift_card_settlements;
CREATE POLICY gift_card_settlements_update ON public.gift_card_settlements
  FOR UPDATE TO authenticated
  USING (
    public.gift_cards_is_business_member(issuer_business_id)
    OR public.gift_cards_is_business_member(redeemer_business_id)
  )
  WITH CHECK (
    public.gift_cards_is_business_member(issuer_business_id)
    OR public.gift_cards_is_business_member(redeemer_business_id)
  );

DROP POLICY IF EXISTS gift_card_settlements_delete ON public.gift_card_settlements;
CREATE POLICY gift_card_settlements_delete ON public.gift_card_settlements
  FOR DELETE TO authenticated
  USING (public.gift_cards_is_business_owner(issuer_business_id));
