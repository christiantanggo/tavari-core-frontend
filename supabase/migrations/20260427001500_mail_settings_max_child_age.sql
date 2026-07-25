ALTER TABLE public.mail_settings
  ADD COLUMN IF NOT EXISTS max_child_age_for_automations integer NOT NULL DEFAULT 12
    CHECK (max_child_age_for_automations BETWEEN 0 AND 25);

COMMENT ON COLUMN public.mail_settings.max_child_age_for_automations IS
  'Max child age used by age-limited mail automations. Automations opt into this rule via criteria.apply_max_child_age_rule.';
