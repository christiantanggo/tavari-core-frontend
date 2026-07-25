/**
 * Supabase client often throws plain objects ({ message, details, code }), not Error instances.
 * String(obj) → "[object Object]" — use this for toasts and logs instead.
 */
export function formatUnknownError(value, fallback = 'Something went wrong') {
  if (value == null || value === '') return fallback;
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message || fallback;
  if (typeof value === 'object') {
    const msg = typeof value.message === 'string' ? value.message.trim() : '';
    const details = typeof value.details === 'string' ? value.details.trim() : '';
    const hint = typeof value.hint === 'string' ? value.hint.trim() : '';
    const code = typeof value.code === 'string' ? value.code.trim() : '';
    const parts = [msg || null, details || null, hint ? `(${hint})` : null, code ? `[${code}]` : null].filter(
      Boolean
    );
    if (parts.length) return parts.join(' ');
    if (typeof value.error === 'string' && value.error.trim()) return value.error.trim();
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return String(value);
}

/** Supabase functions.invoke sets data=null on 5xx; error.context may be the Response with JSON body */
export async function readEdgeFunctionErrorMessage(error, fallback = 'Request failed') {
  const ctx = error?.context;
  if (ctx && typeof ctx.clone === 'function') {
    try {
      const ct = ctx.headers?.get?.('Content-Type') || '';
      if (ct.includes('application/json')) {
        const body = await ctx.clone().json();
        if (body?.error != null && body.error !== '') {
          return formatUnknownError(body.error, fallback);
        }
      }
    } catch {
      /* ignore parse failures */
    }
  }
  return formatUnknownError(error, fallback);
}
