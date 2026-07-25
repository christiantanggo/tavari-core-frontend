/**
 * Canonical object path in Supabase Storage bucket `waivers`.
 * Must match waivers_get_waiver_pdf_url() and archival upload logic.
 */
export function getCanonicalSignedWaiverPdfStoragePath(businessId, waiverId) {
  if (!businessId || !waiverId) {
    throw new Error('businessId and waiverId are required for signed waiver PDF path');
  }
  return `waivers/${businessId}/${waiverId}.pdf`;
}
