-- Store in-checkout Terms & Conditions acknowledgment on Helcim pending rows
-- so auto-approve day camp bookings can finalize as already signed.

ALTER TABLE public.booking_pending_helcim
  ADD COLUMN IF NOT EXISTS terms_acknowledgment JSONB;

COMMENT ON COLUMN public.booking_pending_helcim.terms_acknowledgment IS
  'Optional Terms & Conditions acknowledgment captured during portal checkout before payment. Shape: { packageId, signerName, signatureData, acknowledgments: [{ stepId }], signedAt }.';
