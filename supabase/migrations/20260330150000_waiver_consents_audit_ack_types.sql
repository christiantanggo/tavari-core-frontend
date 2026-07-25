-- Extend waiver_consents.consent_type for auditable waiver-flow acknowledgements
-- (terms read, electronic signature, additional-adult intent) alongside marketing/photography/etc.

DO $$
DECLARE
  con_name text;
BEGIN
  FOR con_name IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'waiver_consents'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%consent_type%'
  LOOP
    EXECUTE format('ALTER TABLE waiver_consents DROP CONSTRAINT IF EXISTS %I', con_name);
  END LOOP;
END $$;

ALTER TABLE waiver_consents
  ADD CONSTRAINT waiver_consents_consent_type_check
  CHECK (
    consent_type IN (
      'marketing',
      'photography',
      'medical',
      'other',
      'waiver_terms',
      'electronic_signature',
      'additional_adult_intent'
    )
  );

COMMENT ON TABLE waiver_consents IS
  'Consent and acknowledgement tracking: marketing/photography/medical/other plus waiver_terms, electronic_signature, additional_adult_intent for audits.';
