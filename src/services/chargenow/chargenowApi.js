/**
 * ChargeNow / Bajie shared power bank API — calls Supabase Edge Function `chargenow-api`
 * (Basic auth + vendor URL stay server-side).
 */
import { supabase } from '../../supabaseClient';

/**
 * @param {string} businessId - Tavari business UUID (authorization checked in Edge Function)
 * @param {Record<string, unknown>} payload - must include `action` plus endpoint-specific fields
 * @returns {Promise<{ ok?: boolean, status?: number, data?: unknown, error?: string }>}
 */
export async function chargenowInvoke(businessId, payload) {
  if (!businessId) throw new Error('businessId is required');

  const { data, error } = await supabase.functions.invoke('chargenow-api', {
    body: {
      businessId,
      ...payload,
    },
  });

  if (error) {
    const msg = error.message || 'ChargeNow proxy failed';
    throw new Error(msg);
  }

  return data;
}

/** Helper: prettify proxy envelope for UI */
export function formatChargenowResponse(data) {
  if (!data) return '';
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}
