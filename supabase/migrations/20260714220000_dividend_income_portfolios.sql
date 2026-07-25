-- Portfolios (people / buckets) for Dividend Income holdings — not hardcoded names

CREATE TABLE IF NOT EXISTS public.div_portfolios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);

CREATE INDEX IF NOT EXISTS idx_div_portfolios_business ON public.div_portfolios (business_id, sort_order);

ALTER TABLE public.div_portfolios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS div_portfolios_select ON public.div_portfolios;
CREATE POLICY div_portfolios_select
  ON public.div_portfolios FOR SELECT TO authenticated
  USING (public.div_is_business_member(business_id));

DROP POLICY IF EXISTS div_portfolios_insert ON public.div_portfolios;
CREATE POLICY div_portfolios_insert
  ON public.div_portfolios FOR INSERT TO authenticated
  WITH CHECK (public.div_is_business_manager(business_id));

DROP POLICY IF EXISTS div_portfolios_update ON public.div_portfolios;
CREATE POLICY div_portfolios_update
  ON public.div_portfolios FOR UPDATE TO authenticated
  USING (public.div_is_business_manager(business_id))
  WITH CHECK (public.div_is_business_manager(business_id));

DROP POLICY IF EXISTS div_portfolios_delete ON public.div_portfolios;
CREATE POLICY div_portfolios_delete
  ON public.div_portfolios FOR DELETE TO authenticated
  USING (public.div_is_business_manager(business_id));

-- Attach holdings to a portfolio
ALTER TABLE public.div_holdings
  ADD COLUMN IF NOT EXISTS portfolio_id UUID REFERENCES public.div_portfolios(id) ON DELETE CASCADE;

-- Backfill: one default portfolio per personal business that has instruments/holdings
DO $$
DECLARE
  r RECORD;
  v_portfolio_id UUID;
BEGIN
  FOR r IN
    SELECT DISTINCT business_id
    FROM public.div_instruments
  LOOP
    SELECT id INTO v_portfolio_id
    FROM public.div_portfolios
    WHERE business_id = r.business_id
    ORDER BY sort_order, created_at
    LIMIT 1;

    IF v_portfolio_id IS NULL THEN
      INSERT INTO public.div_portfolios (business_id, name, sort_order)
      VALUES (r.business_id, 'My Holdings', 0)
      RETURNING id INTO v_portfolio_id;
    END IF;

    UPDATE public.div_holdings
    SET portfolio_id = v_portfolio_id
    WHERE business_id = r.business_id
      AND portfolio_id IS NULL;
  END LOOP;
END $$;

-- Replace unique (business, instrument) with (portfolio, instrument)
ALTER TABLE public.div_holdings
  DROP CONSTRAINT IF EXISTS div_holdings_business_id_instrument_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'div_holdings_portfolio_id_instrument_id_key'
  ) THEN
    ALTER TABLE public.div_holdings
      ADD CONSTRAINT div_holdings_portfolio_id_instrument_id_key
      UNIQUE (portfolio_id, instrument_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_div_holdings_portfolio ON public.div_holdings (portfolio_id);
