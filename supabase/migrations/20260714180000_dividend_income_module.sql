-- Private Dividend Income module (Christian Fournier personal business only)

INSERT INTO public.app_modules (module_key, module_name, description, icon, enabled_by_default, module_category)
VALUES (
  'dividend_income',
  'Dividend Income',
  'Private Canadian monthly dividend income optimizer (personal use)',
  'FiDollarSign',
  false,
  'Personal'
)
ON CONFLICT (module_key) DO UPDATE SET
  module_name = EXCLUDED.module_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  module_category = EXCLUDED.module_category,
  enabled_by_default = false;

-- Watchlist / catalog of monthly dividend instruments (provider-agnostic)
CREATE TABLE IF NOT EXISTS public.div_instruments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  exchange TEXT NOT NULL DEFAULT 'TSX',
  yahoo_symbol TEXT,
  name TEXT NOT NULL,
  provider TEXT,
  fund_type TEXT,
  currency TEXT NOT NULL DEFAULT 'CAD',
  expected_monthly_dividend NUMERIC(18, 6),
  last_price NUMERIC(18, 6),
  last_nav NUMERIC(18, 6),
  last_nav_date DATE,
  downside_protection NUMERIC(18, 6),
  pays_monthly BOOLEAN NOT NULL DEFAULT true,
  variable_distribution BOOLEAN NOT NULL DEFAULT false,
  stable_months INTEGER NOT NULL DEFAULT 0,
  disqualified_reason TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  price_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_div_instruments_business ON public.div_instruments (business_id);

-- Price / NAV snapshots
CREATE TABLE IF NOT EXISTS public.div_price_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  instrument_id UUID NOT NULL REFERENCES public.div_instruments(id) ON DELETE CASCADE,
  as_of TIMESTAMPTZ NOT NULL DEFAULT now(),
  price NUMERIC(18, 6),
  nav NUMERIC(18, 6),
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_div_price_snapshots_instr ON public.div_price_snapshots (instrument_id, as_of DESC);

-- Distribution history (for qualification)
CREATE TABLE IF NOT EXISTS public.div_distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  instrument_id UUID NOT NULL REFERENCES public.div_instruments(id) ON DELETE CASCADE,
  pay_date DATE NOT NULL,
  amount_per_share NUMERIC(18, 6) NOT NULL,
  is_special BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instrument_id, pay_date)
);

CREATE INDEX IF NOT EXISTS idx_div_distributions_instr ON public.div_distributions (instrument_id, pay_date DESC);

-- Corporate actions (splits, etc.)
CREATE TABLE IF NOT EXISTS public.div_corporate_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  instrument_id UUID NOT NULL REFERENCES public.div_instruments(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL DEFAULT 'split',
  announcement_date DATE,
  effective_date DATE,
  split_ratio TEXT,
  share_price_at NUMERIC(18, 6),
  nav_at NUMERIC(18, 6),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Holdings (purchases)
CREATE TABLE IF NOT EXISTS public.div_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  instrument_id UUID NOT NULL REFERENCES public.div_instruments(id) ON DELETE CASCADE,
  shares NUMERIC(18, 6) NOT NULL DEFAULT 0,
  avg_cost NUMERIC(18, 6),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, instrument_id)
);

CREATE INDEX IF NOT EXISTS idx_div_holdings_business ON public.div_holdings (business_id);

ALTER TABLE public.div_instruments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.div_price_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.div_distributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.div_corporate_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.div_holdings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.div_is_business_member(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.business_users bu
    WHERE bu.business_id = p_business_id
      AND bu.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.business_id = p_business_id
      AND ur.user_id = auth.uid()
      AND ur.active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.div_is_business_manager(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.business_users bu
    WHERE bu.business_id = p_business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('owner', 'admin', 'manager')
  );
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'div_instruments',
    'div_price_snapshots',
    'div_distributions',
    'div_corporate_actions',
    'div_holdings'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_select ON public.%I FOR SELECT TO authenticated USING (public.div_is_business_member(business_id))',
      t, t
    );
    EXECUTE format('DROP POLICY IF EXISTS %I_insert ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.div_is_business_manager(business_id))',
      t, t
    );
    EXECUTE format('DROP POLICY IF EXISTS %I_update ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_update ON public.%I FOR UPDATE TO authenticated USING (public.div_is_business_manager(business_id)) WITH CHECK (public.div_is_business_manager(business_id))',
      t, t
    );
    EXECUTE format('DROP POLICY IF EXISTS %I_delete ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_delete ON public.%I FOR DELETE TO authenticated USING (public.div_is_business_manager(business_id))',
      t, t
    );
  END LOOP;
END $$;

-- Create personal business + enable module + seed Quadravest watchlist for 5@tanggo.ca
DO $$
DECLARE
  v_user_id uuid;
  v_business_id uuid;
  v_ftn_id uuid;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower('5@tanggo.ca')
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'dividend_income: user 5@tanggo.ca not found; skipping personal business seed';
    RETURN;
  END IF;

  SELECT b.id INTO v_business_id
  FROM public.businesses b
  WHERE lower(trim(b.name)) = lower('Christian Fournier')
  ORDER BY b.created_at ASC
  LIMIT 1;

  IF v_business_id IS NULL THEN
    INSERT INTO public.businesses (name, created_by, created_at)
    VALUES ('Christian Fournier', v_user_id, now())
    RETURNING id INTO v_business_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_users
    WHERE business_id = v_business_id AND user_id = v_user_id
  ) THEN
    INSERT INTO public.business_users (business_id, user_id, role, created_at)
    VALUES (v_business_id, v_user_id, 'owner', now());
  ELSE
    UPDATE public.business_users
    SET role = 'owner'
    WHERE business_id = v_business_id AND user_id = v_user_id;
  END IF;

  INSERT INTO public.business_module_usage (
    business_id, module_key, module_name, enabled, usage_count, created_at, updated_at
  )
  VALUES (
    v_business_id, 'dividend_income', 'Dividend Income', true, 0, now(), now()
  )
  ON CONFLICT (business_id, module_key) DO UPDATE SET
    enabled = true,
    module_name = EXCLUDED.module_name,
    updated_at = now();

  -- Seed instruments
  INSERT INTO public.div_instruments (
    business_id, ticker, yahoo_symbol, name, provider, fund_type,
    expected_monthly_dividend, last_price, pays_monthly, variable_distribution, stable_months, active
  ) VALUES
    (v_business_id, 'FTN', 'FTN.TO', 'Financial 15 Split Corp.', 'Quadravest', 'split_share', 0.1257, 12.75, true, false, 36, true),
    (v_business_id, 'DFN', 'DFN.TO', 'Dividend 15 Split Corp.', 'Quadravest', 'split_share', 0.10, NULL, true, false, 36, true),
    (v_business_id, 'FFN', 'FFN.TO', 'North American Financial 15 Split Corp.', 'Quadravest', 'split_share', 0.10, NULL, true, false, 24, true),
    (v_business_id, 'DF', 'DF.TO', 'Dividend 15 Split Corp. II', 'Quadravest', 'split_share', 0.10, NULL, true, false, 24, true),
    (v_business_id, 'FTU', 'FTU.TO', 'US Financial 15 Split Corp.', 'Quadravest', 'split_share', NULL, NULL, false, false, 0, true),
    (v_business_id, 'BK', 'BK.TO', 'Canadian Banc Corp.', 'Quadravest', 'split_share', NULL, NULL, true, true, 0, true)
  ON CONFLICT (business_id, ticker) DO UPDATE SET
    yahoo_symbol = EXCLUDED.yahoo_symbol,
    name = EXCLUDED.name,
    provider = EXCLUDED.provider,
    expected_monthly_dividend = COALESCE(public.div_instruments.expected_monthly_dividend, EXCLUDED.expected_monthly_dividend),
    variable_distribution = EXCLUDED.variable_distribution,
    updated_at = now();

  SELECT id INTO v_ftn_id
  FROM public.div_instruments
  WHERE business_id = v_business_id AND ticker = 'FTN'
  LIMIT 1;

  IF v_ftn_id IS NOT NULL THEN
    INSERT INTO public.div_holdings (business_id, instrument_id, shares, avg_cost, notes)
    VALUES (v_business_id, v_ftn_id, 10586, 6.52, 'Seeded from current FTN position')
    ON CONFLICT (business_id, instrument_id) DO NOTHING;
  END IF;

  RAISE NOTICE 'dividend_income: personal business % ready for 5@tanggo.ca', v_business_id;
END $$;
