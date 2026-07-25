const FINIX_USERNAME = Deno.env.get('FINIX_USERNAME');
const FINIX_PASSWORD = Deno.env.get('FINIX_PASSWORD');
const FINIX_BASE_URL = Deno.env.get('FINIX_BASE_URL') || 'https://finix.sandbox-payments-api.com';
const FINIX_VERSION = Deno.env.get('FINIX_VERSION') || '2022-02-01';

if (!FINIX_USERNAME || !FINIX_PASSWORD) {
  console.error('❌ Missing Finix credentials. Please set FINIX_USERNAME and FINIX_PASSWORD in Supabase secrets.');
}

const basicAuthToken = FINIX_USERNAME && FINIX_PASSWORD
  ? btoa(`${FINIX_USERNAME}:${FINIX_PASSWORD}`)
  : '';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const jsonHeaders: Record<string, string> = {
  ...corsHeaders,
  'Content-Type': 'application/json',
};

export function handleOptions(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }
  return null;
}

export interface FinixRequestOptions {
  path: string;
  method?: string;
  body?: Record<string, unknown> | null;
  query?: Record<string, string | number | boolean | undefined>;
}

export async function callFinix<T = Record<string, unknown>>({
  path,
  method = 'GET',
  body = null,
  query,
}: FinixRequestOptions): Promise<T> {
  if (!FINIX_USERNAME || !FINIX_PASSWORD) {
    throw new Error('Finix credentials are not configured.');
  }

  if (!path.startsWith('/')) {
    throw new Error('Finix path must start with a "/"');
  }

  const url = new URL(`${FINIX_BASE_URL}${path}`);

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, String(value));
      }
    });
  }

  const requestInit: RequestInit = {
    method,
    headers: {
      'Authorization': `Basic ${basicAuthToken}`,
      'Content-Type': 'application/json',
      'Finix-Version': FINIX_VERSION,
    },
  };

  if (body && method !== 'GET') {
    requestInit.body = JSON.stringify(body);
  }

  const response = await fetch(url.toString(), requestInit);
  const text = await response.text();

  let data: T | { error?: unknown };
  try {
    data = text ? JSON.parse(text) : ({} as T);
  } catch (parseError) {
    console.error('💥 Failed to parse Finix response JSON:', text);
    throw new Error(`Finix returned non-JSON response: ${response.status}`);
  }

  if (!response.ok) {
    console.error('❌ Finix API error:', data);
    const errorMessage = (data as { error?: { message?: string } })?.error?.message;
    throw new Error(errorMessage || `Finix API error (${response.status})`);
  }

  return data as T;
}

export function buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>) {
  const url = new URL(`${FINIX_BASE_URL}${path}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, String(value));
      }
    });
  }
  return url.toString();
}



