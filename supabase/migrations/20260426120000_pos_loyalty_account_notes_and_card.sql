-- Account notes, visual card style (POS / profile lists), and waiver check-in restriction.

ALTER TABLE public.pos_loyalty_accounts
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS account_card_style text NOT NULL DEFAULT 'default'
    CHECK (account_card_style = ANY (ARRAY['default', 'info', 'success', 'warning', 'danger', 'banned'])),
  ADD COLUMN IF NOT EXISTS restrict_check_in boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.pos_loyalty_accounts.notes IS 'Internal staff notes for this customer account (POS / CRM).';
COMMENT ON COLUMN public.pos_loyalty_accounts.account_card_style IS 'How to render this customer in POS lists and profile summary cards (accent / alert).';
COMMENT ON COLUMN public.pos_loyalty_accounts.restrict_check_in IS 'When true, waiver check-in is blocked for waivers linked to this loyalty account.';
