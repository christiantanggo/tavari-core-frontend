CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.app_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key text NOT NULL UNIQUE,
  module_name text NOT NULL,
  description text,
  icon text,
  enabled_by_default boolean DEFAULT false,
  module_category text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_modules_module_key
  ON public.app_modules(module_key);

CREATE INDEX IF NOT EXISTS idx_app_modules_category
  ON public.app_modules(module_category);

ALTER TABLE public.app_modules ENABLE ROW LEVEL SECURITY;
