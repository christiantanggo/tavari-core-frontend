/**
 * Finalize immutable signed waiver PDF via Edge Function (service-role Storage upload).
 * Client no longer uploads directly to waivers/{business_id}/{waiver_id}.pdf.
 */
import { invokeWaiverArchive, FINALIZE_FN } from './waiverArchiveInvoke';

/**
 * @param {string} waiverId
 * @param {string} businessId
 * @param {{ signatureToken?: string }} [options] — required when caller has no Supabase session (public waiver flow)
 * @returns {Promise<object>} Same JSON as waiver-archive-email (success, archived, storagePath, emailed, …).
 */
export async function finalizeSignedWaiverPdfArchival(waiverId, businessId, options = {}) {
  const { signatureToken } = options;

  const result = await invokeWaiverArchive(
    {
      waiverId,
      businessId,
      signatureToken,
      sendEmail: false
    },
    { functionName: FINALIZE_FN }
  );

  return result;
}
