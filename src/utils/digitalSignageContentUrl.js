import { supabase } from '../supabaseClient';

const DIGITAL_SIGNAGE_BUCKET = 'digital-signage-content';
const DEFAULT_SIGNED_URL_TTL_SEC = 3600;

/**
 * Resolve a browser-loadable URL for digital signage storage.
 * The bucket is private; stored file_url values from getPublicUrl() are not usable.
 */
export async function resolveDigitalSignagePreviewUrl(
  content,
  { ttlSec = DEFAULT_SIGNED_URL_TTL_SEC } = {}
) {
  if (!content) return null;

  const fp = content.file_path && String(content.file_path).trim();
  if (fp) {
    try {
      const { data, error } = await supabase.storage
        .from(DIGITAL_SIGNAGE_BUCKET)
        .createSignedUrl(fp, ttlSec);
      if (!error && data?.signedUrl) return data.signedUrl;
    } catch {
      /* fall through */
    }
  }

  const pub = content.file_url && String(content.file_url).trim();
  return pub || null;
}

/** Build id → preview URL map for a list of content or ad rows with nested content. */
export async function resolveDigitalSignagePreviewUrlMap(
  items,
  { getContent = (row) => row, getId = (row) => row.id, ttlSec = DEFAULT_SIGNED_URL_TTL_SEC } = {}
) {
  const next = {};
  const list = Array.isArray(items) ? items : [];
  for (const row of list) {
    const content = getContent(row);
    const id = getId(row);
    if (!id || !content) continue;
    const url = await resolveDigitalSignagePreviewUrl(content, { ttlSec });
    if (url) next[id] = url;
  }
  return next;
}
