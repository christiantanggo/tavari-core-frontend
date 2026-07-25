-- Unify POS register stations: one row = sales terminal + Helcim device + cash drawer float
ALTER TABLE public.pos_terminals
  ADD COLUMN IF NOT EXISTS helcim_device_code text,
  ADD COLUMN IF NOT EXISTS float_amount numeric(10, 2) NOT NULL DEFAULT 200.00,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.pos_terminals.helcim_device_code IS 'Helcim Gen 2 device code (e.g. JSV5) for card payments at this station';
COMMENT ON COLUMN public.pos_terminals.float_amount IS 'Cash drawer float for daily deposit expected totals at this station';

-- Migrate legacy pos_cash_tills rows into pos_terminals when present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'pos_cash_tills'
  ) THEN
    UPDATE public.pos_terminals pt
    SET
      float_amount = ct.float_amount,
      terminal_name = CASE
        WHEN pt.terminal_name IS NULL OR btrim(pt.terminal_name) = '' THEN ct.name
        ELSE pt.terminal_name
      END,
      updated_at = timezone('utc'::text, now())
    FROM public.pos_cash_tills ct
    WHERE ct.business_id = pt.business_id
      AND ct.pos_terminal_id IS NOT NULL
      AND btrim(ct.pos_terminal_id) <> ''
      AND ct.pos_terminal_id = pt.terminal_id
      AND ct.is_active = true;

    INSERT INTO public.pos_terminals (
      business_id,
      terminal_name,
      terminal_id,
      float_amount,
      location_description,
      is_active,
      sort_order
    )
    SELECT
      ct.business_id,
      ct.name,
      COALESCE(
        NULLIF(btrim(ct.pos_terminal_id), ''),
        'TILL_' || upper(substring(replace(ct.id::text, '-', ''), 1, 12))
      ),
      ct.float_amount,
      'Migrated from cash till setup',
      ct.is_active,
      ct.sort_order
    FROM public.pos_cash_tills ct
    WHERE ct.is_active = true
      AND NOT EXISTS (
        SELECT 1
        FROM public.pos_terminals pt
        WHERE pt.business_id = ct.business_id
          AND pt.terminal_id = COALESCE(
            NULLIF(btrim(ct.pos_terminal_id), ''),
            'TILL_' || upper(substring(replace(ct.id::text, '-', ''), 1, 12))
          )
      );
  END IF;
END $$;
