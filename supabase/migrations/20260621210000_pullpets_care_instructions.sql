-- Daily care / sitter handoff notes per pet (feeding, crate, toys, etc.)
ALTER TABLE public.pullpets_pets
  ADD COLUMN IF NOT EXISTS care_instructions jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.pullpets_pets.care_instructions IS
  'Structured sitter handoff notes keyed by section id (feeding, crating, toys, …).';
