/**
 * Invoke waiver archive Edge Functions (service-side PDF build + Storage upload).
 * Use Authorization: user JWT when available; otherwise anon key + signatureToken in body.
 */
import { supabase } from '../../supabaseClient';

const DEFAULT_ARCHIVE_FN = 'waiver-archive-email';
const FINALIZE_FN = 'waiver-finalize-signed-pdf';

/**
 * @param {object} payload
 * @param {string} payload.waiverId
 * @param {string} payload.businessId
 * @param {string} [payload.signatureToken] - required for public/anon signing flows when no session
 * @param {string|null} [payload.recipientEmail]
 * @param {boolean} [payload.sendEmail]
 * @param {{ functionName?: string }} [options]
 */
export async function invokeWaiverArchive(payload, options = {}) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const functionName = options.functionName || DEFAULT_ARCHIVE_FN;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are not configured for waiver archive');
  }

  const {
    data: { session }
  } = await supabase.auth.getSession();

  const headers = {
    'Content-Type': 'application/json',
    apikey: supabaseAnonKey
  };

  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  } else {
    headers.Authorization = `Bearer ${supabaseAnonKey}`;
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  const responseBody = await response.json().catch(() => null);
  if (!response.ok || responseBody?.success !== true) {
    throw new Error(responseBody?.error || 'Failed to archive signed waiver');
  }

  return responseBody;
}

export { DEFAULT_ARCHIVE_FN, FINALIZE_FN };
