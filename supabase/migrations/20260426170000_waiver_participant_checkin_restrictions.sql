ALTER TABLE public.waiver_participants
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS account_card_style text NOT NULL DEFAULT 'default'
    CHECK (account_card_style = ANY (ARRAY['default', 'info', 'success', 'warning', 'danger', 'banned'])),
  ADD COLUMN IF NOT EXISTS restrict_check_in boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.waiver_participants.notes IS
  'Internal staff notes for this individual waiver participant/person.';

COMMENT ON COLUMN public.waiver_participants.account_card_style IS
  'How to visually flag this individual participant in customer/waiver views.';

COMMENT ON COLUMN public.waiver_participants.restrict_check_in IS
  'When true, check-in is blocked for this specific participant only.';
