const PLAID_ENV = (Deno.env.get('PLAID_ENV') || 'sandbox').toLowerCase();

function plaidBaseUrl() {
  if (PLAID_ENV === 'production') return 'https://production.plaid.com';
  if (PLAID_ENV === 'development') return 'https://development.plaid.com';
  return 'https://sandbox.plaid.com';
}

function plaidCredentials() {
  const clientId = Deno.env.get('PLAID_CLIENT_ID')?.trim();
  const secret = Deno.env.get('PLAID_SECRET')?.trim();
  if (!clientId || !secret) {
    return { ok: false as const, error: 'Plaid is not configured (PLAID_CLIENT_ID / PLAID_SECRET)' };
  }
  return { ok: true as const, clientId, secret };
}

export async function plaidRequest<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const creds = plaidCredentials();
  if (!creds.ok) return creds;

  const res = await fetch(`${plaidBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: creds.clientId,
      secret: creds.secret,
      ...body,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error_message?: string; display_message?: string })?.error_message
      || (data as { display_message?: string })?.display_message
      || `Plaid request failed (${res.status})`;
    return { ok: false, error: msg };
  }
  return { ok: true, data: data as T };
}

export function isPlaidConfigured() {
  return plaidCredentials().ok;
}
