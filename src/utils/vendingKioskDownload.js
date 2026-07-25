/**
 * Tavari Vending Bridge APK download URL (Supabase public storage).
 */

export const VENDING_BRIDGE_APK_VERSION = '1.0.17';
export const VENDING_BRIDGE_APK_FILENAME = `Tavari-Vending-Bridge-${VENDING_BRIDGE_APK_VERSION}.apk`;
export const VENDING_BRIDGE_BUCKET = 'vending-installers';
export const VENDING_BRIDGE_FILENAME_RE = /^Tavari-Vending-Bridge-(\d+\.\d+\.\d+)\.apk$/;

const FALLBACK_SUPABASE_URL = 'https://iagcamwcfuiopmwefohz.supabase.co';

export function getVendingBridgeApkPublicUrl() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL;
  const projectId = supabaseUrl.match(/https?:\/\/([^.]+)/)?.[1];
  if (projectId) {
    return `https://${projectId}.supabase.co/storage/v1/object/public/${VENDING_BRIDGE_BUCKET}/${VENDING_BRIDGE_APK_FILENAME}`;
  }
  const base = import.meta.env.VITE_VENDING_INSTALLER_BASE_URL || `${window.location.origin}/installers/vending`;
  return `${base.replace(/\/$/, '')}/${VENDING_BRIDGE_APK_FILENAME}`;
}

export function getVendingBridgeApkPublicUrlForFilename(filename) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL;
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${VENDING_BRIDGE_BUCKET}/${encodeURIComponent(filename)}`;
}

export function compareVendingBridgeVersions(a, b) {
  const av = String(a?.version || '').split('.').map(Number);
  const bv = String(b?.version || '').split('.').map(Number);
  for (let i = 0; i < Math.max(av.length, bv.length); i += 1) {
    const diff = (bv[i] || 0) - (av[i] || 0);
    if (diff) return diff;
  }
  return String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || ''));
}

export async function listVendingBridgeApks() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!anonKey) {
    throw new Error('Missing Supabase anon key');
  }

  const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/list/${VENDING_BRIDGE_BUCKET}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`
    },
    body: JSON.stringify({
      prefix: '',
      limit: 100,
      offset: 0,
      sortBy: { column: 'name', order: 'desc' }
    })
  });

  if (!res.ok) {
    throw new Error(`Could not list Supabase APKs (HTTP ${res.status})`);
  }

  const rows = await res.json();
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const match = String(row.name || '').match(VENDING_BRIDGE_FILENAME_RE);
      if (!match) return null;
      const size = Number(row.metadata?.size || row.metadata?.contentLength || 0);
      return {
        filename: row.name,
        version: match[1],
        size,
        updatedAt: row.updated_at || row.created_at || null,
        url: getVendingBridgeApkPublicUrlForFilename(row.name)
      };
    })
    .filter(Boolean)
    .sort(compareVendingBridgeVersions);
}

export function getVendingBridgeKioskUrl(shortCode = 'NUQJTT') {
  const code = String(shortCode || '').trim().toUpperCase();
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://www.tavarios.ca';
  return `${origin}/v/${code}?dispense=rs485&bridge=2`;
}

export function isAndroidTablet() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('android');
}
