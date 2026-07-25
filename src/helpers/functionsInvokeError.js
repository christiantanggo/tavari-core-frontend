/**
 * Edge functions often return { error: "..." } in the JSON body while @supabase/functions-js
 * surfaces only "Edge Function returned a non-2xx status code". Parse the real message.
 */
export async function getFunctionsInvokeErrorMessage(error, data) {
  if (data && typeof data.error === 'string' && data.error.trim()) {
    return data.error.trim();
  }
  if (error?.name === 'FunctionsHttpError' && typeof error.context?.clone === 'function') {
    try {
      const parsed = await error.context.clone().json();
      if (typeof parsed?.error === 'string' && parsed.error.trim()) {
        return parsed.error.trim();
      }
    } catch (_) {
      /* ignore */
    }
  }
  const raw = String(error?.message || '').trim();
  if (raw) return raw;
  return 'Request failed';
}
