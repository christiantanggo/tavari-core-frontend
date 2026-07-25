-- Set payroll tax_year to 2026 for all businesses (CRA T4127 122nd edition).
-- Safe if tables are missing on an older fork (no-op blocks).

DO $$
BEGIN
  IF to_regclass('public.hrpayroll_settings') IS NOT NULL THEN
    UPDATE public.hrpayroll_settings
    SET tax_year = 2026
    WHERE tax_year IS NULL OR tax_year <> 2026;
    RAISE NOTICE 'hrpayroll_settings: tax_year set to 2026 for all rows';
  ELSE
    RAISE NOTICE 'hrpayroll_settings: table missing, skipped';
  END IF;

  IF to_regclass('public.hrpayroll_tax_settings') IS NOT NULL THEN
    UPDATE public.hrpayroll_tax_settings
    SET tax_year = 2026
    WHERE tax_year IS NULL OR tax_year <> 2026;
    RAISE NOTICE 'hrpayroll_tax_settings: tax_year set to 2026 for all rows';
  ELSE
    RAISE NOTICE 'hrpayroll_tax_settings: table missing, skipped';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
