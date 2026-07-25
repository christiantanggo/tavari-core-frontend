const DEDUCTLY_BASE = 'https://www.deductly.ca/api/v1';

/**
 * Fetch open Canadian business programs from Deductly.
 * Free public API — no auth. Prefer calling via funding-deductly-sync edge function
 * for server-side caching + reminder alerts; this client helper is for live browse.
 */
export async function fetchDeductlyPrograms({
  province,
  industry,
  type,
  limit = 100,
} = {}) {
  const params = new URLSearchParams();
  if (province) params.set('province', province);
  if (industry) params.set('industry', industry);
  if (type) params.set('type', type);
  if (limit) params.set('limit', String(Math.min(limit, 100)));

  const url = `${DEDUCTLY_BASE}/programs${params.toString() ? `?${params}` : ''}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Deductly API error (${res.status}): ${text.slice(0, 200) || res.statusText}`);
  }

  const data = await res.json();
  return {
    total: data.total ?? (data.results || []).length,
    freshness: data.freshness || null,
    results: Array.isArray(data.results) ? data.results : [],
  };
}
