DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'ingredients'
  ) THEN
    ALTER TABLE public.ingredients
      DROP CONSTRAINT IF EXISTS ingredients_category_id_fkey;

    ALTER TABLE public.ingredients
      ADD CONSTRAINT ingredients_category_id_fkey
      FOREIGN KEY (category_id)
      REFERENCES public.pos_categories(id)
      ON DELETE SET NULL;
  END IF;
END $$;
