CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.app_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key TEXT NOT NULL UNIQUE,
  module_name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  enabled_by_default BOOLEAN DEFAULT false,
  module_category TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_modules_module_key
  ON public.app_modules(module_key);

CREATE INDEX IF NOT EXISTS idx_app_modules_category
  ON public.app_modules(module_category);

ALTER TABLE public.app_modules ENABLE ROW LEVEL SECURITY;
