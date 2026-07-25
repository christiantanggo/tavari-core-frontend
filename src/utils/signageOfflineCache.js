const DB_NAME = 'tavari-signage-cache';
const DB_VERSION = 1;
const STORE = 'media';
const MAX_CACHE_ITEMS = 80;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'contentId' });
      }
    };
  });
}

/** @returns {Promise<string|null>} blob object URL */
export async function getCachedMediaUrl(contentId) {
  if (!contentId) return null;
  try {
    const db = await openDb();
    const entry = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(contentId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (entry?.blob) {
      return URL.createObjectURL(entry.blob);
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function cacheMediaItem(contentId, networkUrl, mimeType) {
  if (!contentId || !networkUrl) return false;
  try {
    const res = await fetch(networkUrl, { mode: 'cors', cache: 'force-cache' });
    if (!res.ok) return false;
    const blob = await res.blob();
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({
        contentId,
        blob,
        mimeType: mimeType || blob.type,
        cachedAt: Date.now(),
        sourceUrl: networkUrl
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    await pruneMediaCache(MAX_CACHE_ITEMS);
    return true;
  } catch (e) {
    console.warn('[signageOfflineCache] cache failed', contentId, e);
    return false;
  }
}

export async function pruneMediaCache(maxItems = MAX_CACHE_ITEMS) {
  try {
    const db = await openDb();
    const entries = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    const overflow = entries
      .sort((a, b) => (b.cachedAt || 0) - (a.cachedAt || 0))
      .slice(maxItems);
    if (overflow.length > 0) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        overflow.forEach((entry) => {
          if (entry?.contentId) store.delete(entry.contentId);
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
    db.close();
  } catch {
    /* cache pruning is best effort */
  }
}

/** Prefetch all playlist items; returns count cached. */
export async function prefetchManifestItems(items) {
  const list = Array.isArray(items) ? items : [];
  let ok = 0;
  for (const item of list) {
    if (!item?.contentId || !item?.url) continue;
    const hit = await getCachedMediaUrl(item.contentId);
    if (hit) {
      URL.revokeObjectURL(hit);
      ok += 1;
      continue;
    }
    const cached = await cacheMediaItem(item.contentId, item.url, item.mimeType);
    if (cached) ok += 1;
  }
  return ok;
}

export async function resolvePlaybackUrl(item) {
  if (!item) return null;
  const cached = await getCachedMediaUrl(item.contentId);
  if (cached) return cached;
  return item.url || null;
}

export function revokeBlobUrl(url) {
  if (url && String(url).startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
}
