-- Mailing/contact address per participant (additional adults, primary row) + city on signature for primary signer.

ALTER TABLE waiver_signatures
  ADD COLUMN IF NOT EXISTS city TEXT;

ALTER TABLE waiver_participants
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS postal_code TEXT;

COMMENT ON COLUMN waiver_participants.address IS 'Participant street address (adults; optional)';
COMMENT ON COLUMN waiver_participants.city IS 'Participant city';
COMMENT ON COLUMN waiver_participants.postal_code IS 'Participant postal / ZIP code';
COMMENT ON COLUMN waiver_signatures.city IS 'Primary signer city (mailing)';
