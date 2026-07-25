// Tavari Music System - Service Worker for Music File Caching
// This file runs independently and caches music files automatically

const CACHE_NAME = 'tavari-music-cache-v1';
const MUSIC_CACHE_SIZE_LIMIT = 50; // Number of tracks to cache

// Install event - set up the cache
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  self.skipWaiting(); // Activate immediately
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim(); // Take control immediately
});

// Fetch event — only intercept Supabase public music-files (cache layer).
// Do NOT wrap other requests in respondWith(fetch): a rejected fetch breaks navigations
// (e.g. /portal/schedule) with "Failed to fetch" and uncaught promise rejections.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.hostname.includes('supabase') && url.pathname.includes('/storage/v1/object/public/music-files/')) {
    event.respondWith(handleMusicRequest(event.request));
  }
});

// Handle music file requests with caching
async function handleMusicRequest(request) {
  try {
    // Try to get from cache first
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('[Service Worker] Serving from cache:', request.url);
      return cachedResponse;
    }

    // Not in cache - fetch from network
    console.log('[Service Worker] Fetching from network:', request.url);
    const networkResponse = await fetch(request);

    // If successful, cache only real audio (avoid caching HTML error pages as "tracks")
    if (networkResponse.ok) {
      const ct = (networkResponse.headers.get('content-type') || '').toLowerCase();
      if (
        !ct.includes('audio') &&
        !ct.includes('octet-stream') &&
        !ct.includes('mpeg') &&
        !ct.includes('mp4')
      ) {
        console.warn('[Service Worker] Skipping cache — not audio:', ct, request.url);
        return networkResponse;
      }
      const cache = await caches.open(CACHE_NAME);
      
      // Check cache size and remove oldest if needed
      const keys = await cache.keys();
      if (keys.length >= MUSIC_CACHE_SIZE_LIMIT) {
        // Remove the first (oldest) cached item
        await cache.delete(keys[0]);
        console.log('[Service Worker] Cache limit reached, removed oldest file');
      }
      
      // Add new file to cache
      await cache.put(request, networkResponse.clone());
      console.log('[Service Worker] Cached new file:', request.url);
    }

    return networkResponse;

  } catch (error) {
    console.error('[Service Worker] Fetch failed:', error);
    
    // If network fails, try cache as fallback
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('[Service Worker] Network failed, serving from cache:', request.url);
      return cachedResponse;
    }
    
    // No cache — must return a Response; never reject respondWith()
    console.warn('[Service Worker] No cache fallback for:', request.url);
    return Response.error();
  }
}

// Message handler for cache management commands
self.addEventListener('message', async (event) => {
  if (event.data.type === 'CLEAR_CACHE') {
    console.log('[Service Worker] Clearing all cached music files...');
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    await Promise.all(keys.map(key => cache.delete(key)));
    event.ports[0].postMessage({ success: true, message: 'Cache cleared' });
  }
  
  if (event.data.type === 'GET_CACHE_SIZE') {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    event.ports[0].postMessage({ 
      success: true, 
      size: keys.length,
      limit: MUSIC_CACHE_SIZE_LIMIT 
    });
  }
});