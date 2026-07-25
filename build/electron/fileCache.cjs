// build/electron/fileCache.cjs
// PHASE 2, STEPS 26-37: File cache module for offline track storage
// Purpose: Manage local file system cache for music tracks

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

// Cache metadata structure:
// {
//   tracks: {
//     [trackId]: {
//       filePath: string,
//       fileSizeBytes: number,
//       checksum: string,
//       cachedAt: timestamp,
//       lastAccessed: timestamp,
//       accessCount: number,
//       expiresAt: timestamp (optional)
//     }
//   },
//   version: string,
//   lastSync: timestamp
// }

let cacheMetadata = null;
let cacheMetadataPath = null;
let cacheDirectory = null;
let cacheStatsCache = null;
let cacheStatsCacheTime = null;
const CACHE_STATS_TTL = 60000; // 1 minute

/** Max on-disk cache for mirrored MP3s (bytes). Override with env TAVARI_MUSIC_CACHE_MAX_MB on kiosk builds. */
function getMaxCacheBytes() {
  const mb = parseInt(process.env.TAVARI_MUSIC_CACHE_MAX_MB || '200', 10);
  const safe = Number.isFinite(mb) && mb > 10 ? mb : 200;
  return safe * 1024 * 1024;
}

/** Sum of fileSizeBytes from metadata (async — loads metadata). */
async function getTotalCachedBytes() {
  await loadCacheMetadata();
  let total = 0;
  for (const id of Object.keys(cacheMetadata.tracks)) {
    total += cacheMetadata.tracks[id].fileSizeBytes || 0;
  }
  return total;
}

/**
 * Remove multiple tracks in one metadata write.
 * @param {string[]} trackIds
 */
async function deleteTracksBatch(trackIds) {
  if (!trackIds || trackIds.length === 0) {
    return { freedBytes: 0, deletedCount: 0 };
  }
  await loadCacheMetadata();
  let freedBytes = 0;
  let deletedCount = 0;
  for (const trackId of trackIds) {
    const trackInfo = cacheMetadata.tracks[trackId];
    if (!trackInfo) continue;
    try {
      await fs.unlink(trackInfo.filePath);
    } catch {
      /* already gone */
    }
    freedBytes += trackInfo.fileSizeBytes || 0;
    delete cacheMetadata.tracks[trackId];
    deletedCount++;
  }
  cacheStatsCache = null;
  await saveCacheMetadata();
  return { freedBytes, deletedCount };
}

/**
 * Evict least-recently-used tracks until at least minBytesToFree bytes would be freed,
 * or until the cache is empty. Uses lastAccessed (fallback cachedAt).
 */
async function evictLeastRecentlyUsedBytes(minBytesToFree) {
  await loadCacheMetadata();
  const entries = Object.entries(cacheMetadata.tracks).map(([id, t]) => ({
    id,
    ms: new Date(t.lastAccessed || t.cachedAt || 0).getTime(),
    size: t.fileSizeBytes || 0
  }));
  entries.sort((a, b) => a.ms - b.ms);

  let planned = 0;
  const toRemove = [];
  for (const e of entries) {
    if (planned >= minBytesToFree) break;
    toRemove.push(e.id);
    planned += e.size;
  }

  return deleteTracksBatch(toRemove);
}

/** Before writing a new file, drop LRU tracks so total + incoming stays under cap. */
async function ensureRoomForIncomingBytes(incomingBytes, replaceTrackId = null) {
  const maxBytes = getMaxCacheBytes();
  if (incomingBytes > maxBytes) {
    const err = new Error('FILE_EXCEEDS_CACHE_CAP');
    err.code = 'FILE_EXCEEDS_CACHE_CAP';
    err.incomingBytes = incomingBytes;
    err.maxBytes = maxBytes;
    throw err;
  }

  await loadCacheMetadata();
  let total = 0;
  for (const id of Object.keys(cacheMetadata.tracks)) {
    if (replaceTrackId && id === replaceTrackId) continue;
    total += cacheMetadata.tracks[id].fileSizeBytes || 0;
  }

  let needToFree = total + incomingBytes - maxBytes;
  if (needToFree <= 0) return;

  await evictLeastRecentlyUsedBytes(needToFree);

  total = 0;
  await loadCacheMetadata();
  for (const id of Object.keys(cacheMetadata.tracks)) {
    if (replaceTrackId && id === replaceTrackId) continue;
    total += cacheMetadata.tracks[id].fileSizeBytes || 0;
  }
  needToFree = total + incomingBytes - maxBytes;
  if (needToFree > 0) {
    const err = new Error('CACHE_EVICT_INSUFFICIENT');
    err.code = 'CACHE_EVICT_INSUFFICIENT';
    throw err;
  }
}

// STEP 27: Get cache directory path
function getCacheDirectory() {
  if (cacheDirectory) {
    return cacheDirectory;
  }
  
  const userDataPath = app.getPath('userData');
  cacheDirectory = path.join(userDataPath, 'cache');
  
  // Ensure directory exists
  if (!fsSync.existsSync(cacheDirectory)) {
    fsSync.mkdirSync(cacheDirectory, { recursive: true });
  }
  
  return cacheDirectory;
}

// STEP 28: Get cache metadata file path
function getCacheMetadataPath() {
  if (cacheMetadataPath) {
    return cacheMetadataPath;
  }
  
  const cacheDir = getCacheDirectory();
  cacheMetadataPath = path.join(cacheDir, 'cache-metadata.json');
  return cacheMetadataPath;
}

// STEP 29: Load cache metadata
async function loadCacheMetadata() {
  if (cacheMetadata !== null) {
    return cacheMetadata;
  }
  
  const metadataPath = getCacheMetadataPath();
  
  try {
    const data = await fs.readFile(metadataPath, 'utf8');
    cacheMetadata = JSON.parse(data);
    
    // Validate structure
    if (!cacheMetadata.tracks) {
      cacheMetadata.tracks = {};
    }
    if (!cacheMetadata.version) {
      cacheMetadata.version = '1.0';
    }
    
    return cacheMetadata;
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist yet - return empty metadata
      cacheMetadata = {
        tracks: {},
        version: '1.0',
        lastSync: null
      };
      return cacheMetadata;
    }
    
    console.error('Error loading cache metadata:', error);
    // Return empty metadata on error
    cacheMetadata = {
      tracks: {},
      version: '1.0',
      lastSync: null
    };
    return cacheMetadata;
  }
}

// STEP 30: Save cache metadata
async function saveCacheMetadata() {
  const metadataPath = getCacheMetadataPath();
  const tempPath = metadataPath + '.tmp';
  const cacheDir = getCacheDirectory();
  
  try {
    // Ensure directory exists
    if (!fsSync.existsSync(cacheDir)) {
      fsSync.mkdirSync(cacheDir, { recursive: true });
    }
    
    // Write to temp file first (atomic write)
    const data = JSON.stringify(cacheMetadata, null, 2);
    await fs.writeFile(tempPath, data, 'utf8');
    
    // Rename temp file to actual file (atomic on most systems)
    await fs.rename(tempPath, metadataPath);
    
    return true;
  } catch (error) {
    console.error('Error saving cache metadata:', error);
    
    // Try to clean up temp file
    try {
      await fs.unlink(tempPath);
    } catch (unlinkError) {
      // Ignore cleanup errors
    }
    
    return false;
  }
}

// STEP 31: Save track to cache
async function saveTrackToCache(trackId, fileData, metadata = {}) {
  try {
    // Validate inputs
    if (!trackId || typeof trackId !== 'string') {
      throw new Error('Invalid trackId');
    }
    
    if (!Buffer.isBuffer(fileData) && !(fileData instanceof Uint8Array)) {
      throw new Error('fileData must be a Buffer or Uint8Array');
    }

    try {
      await ensureRoomForIncomingBytes(fileData.length, trackId);
    } catch (spaceErr) {
      if (spaceErr && spaceErr.code === 'FILE_EXCEEDS_CACHE_CAP') {
        return {
          success: false,
          error: 'FILE_EXCEEDS_CACHE_CAP',
          skipped: true,
          message: 'Track file larger than maximum cache size — playback will stream without persisting.'
        };
      }
      console.error('Cache eviction failed:', spaceErr);
      return {
        success: false,
        error: spaceErr.message || 'Could not free cache space'
      };
    }
    
    const cacheDir = getCacheDirectory();
    const filename = `${trackId}.mp3`; // Assume MP3, could be made configurable
    const filePath = path.join(cacheDir, filename);
    
    // Calculate checksum (SHA256)
    const hash = crypto.createHash('sha256');
    hash.update(fileData);
    const checksum = hash.digest('hex');
    
    // Write file to disk
    await fs.writeFile(filePath, fileData);
    
    // Get file stats
    const stats = await fs.stat(filePath);
    const fileSizeBytes = stats.size;
    
    // Load current metadata
    await loadCacheMetadata();
    
    // Update metadata
    cacheMetadata.tracks[trackId] = {
      filePath: filePath,
      fileSizeBytes: fileSizeBytes,
      checksum: checksum,
      cachedAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      accessCount: 0,
      expiresAt: metadata.expiresAt || null
    };
    
    cacheMetadata.lastSync = new Date().toISOString();
    
    // Save metadata
    await saveCacheMetadata();
    
    // Invalidate stats cache
    cacheStatsCache = null;
    
    return {
      success: true,
      filePath: filePath,
      fileSizeBytes: fileSizeBytes,
      checksum: checksum
    };
  } catch (error) {
    console.error('Error saving track to cache:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// STEP 32: Get cached track
async function getCachedTrack(trackId) {
  try {
    if (!trackId || typeof trackId !== 'string') {
      return null;
    }
    
    // Load metadata
    await loadCacheMetadata();
    
    const trackInfo = cacheMetadata.tracks[trackId];
    if (!trackInfo) {
      return null;
    }
    
    // Check if file exists
    try {
      await fs.access(trackInfo.filePath);
    } catch (error) {
      // File doesn't exist - remove from metadata
      delete cacheMetadata.tracks[trackId];
      await saveCacheMetadata();
      return null;
    }
    
    // Verify checksum if available (optional - can be slow for large files)
    // For now, we'll skip checksum verification on read for performance
    // It can be done periodically via verifyCacheIntegrity()
    
    // Update last accessed
    trackInfo.lastAccessed = new Date().toISOString();
    trackInfo.accessCount = (trackInfo.accessCount || 0) + 1;
    
    // Save updated metadata
    await saveCacheMetadata();
    
    return trackInfo.filePath;
  } catch (error) {
    console.error('Error getting cached track:', error);
    return null;
  }
}

// STEP 33: Delete cached track
async function deleteCachedTrack(trackId) {
  try {
    if (!trackId || typeof trackId !== 'string') {
      return { success: false, error: 'Invalid trackId' };
    }
    
    // Load metadata
    await loadCacheMetadata();
    
    const trackInfo = cacheMetadata.tracks[trackId];
    if (!trackInfo) {
      return { success: false, error: 'Track not in cache' };
    }
    
    // Delete file
    try {
      await fs.unlink(trackInfo.filePath);
    } catch (error) {
      // File might not exist - continue anyway
      console.warn('File not found when deleting:', trackInfo.filePath);
    }
    
    // Remove from metadata
    delete cacheMetadata.tracks[trackId];
    await saveCacheMetadata();
    
    // Invalidate stats cache
    cacheStatsCache = null;
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting cached track:', error);
    return { success: false, error: error.message };
  }
}

// STEP 34: Get cache size
async function getCacheSize() {
  try {
    // Check cache
    const now = Date.now();
    if (cacheStatsCache && cacheStatsCacheTime && (now - cacheStatsCacheTime) < CACHE_STATS_TTL) {
      return cacheStatsCache.totalSizeBytes;
    }
    
    // Load metadata
    await loadCacheMetadata();
    
    let totalSize = 0;
    for (const trackId in cacheMetadata.tracks) {
      totalSize += cacheMetadata.tracks[trackId].fileSizeBytes || 0;
    }
    
    return totalSize;
  } catch (error) {
    console.error('Error getting cache size:', error);
    return 0;
  }
}

// STEP 35: Clear cache
async function clearCache() {
  try {
    const cacheDir = getCacheDirectory();
    let deletedCount = 0;
    
    // Load metadata to get all track IDs
    await loadCacheMetadata();
    const trackIds = Object.keys(cacheMetadata.tracks);
    
    // Delete all files
    for (const trackId of trackIds) {
      const trackInfo = cacheMetadata.tracks[trackId];
      if (trackInfo && trackInfo.filePath) {
        try {
          await fs.unlink(trackInfo.filePath);
          deletedCount++;
        } catch (error) {
          // File might not exist - continue
          console.warn('File not found when clearing:', trackInfo.filePath);
        }
      }
    }
    
    // Clear metadata
    cacheMetadata = {
      tracks: {},
      version: '1.0',
      lastSync: null
    };
    await saveCacheMetadata();
    
    // Invalidate stats cache
    cacheStatsCache = null;
    
    return { success: true, deletedCount: deletedCount };
  } catch (error) {
    console.error('Error clearing cache:', error);
    return { success: false, error: error.message };
  }
}

// STEP 36: Get cache stats
async function getCacheStats() {
  try {
    // Check cache
    const now = Date.now();
    if (cacheStatsCache && cacheStatsCacheTime && (now - cacheStatsCacheTime) < CACHE_STATS_TTL) {
      return cacheStatsCache;
    }
    
    // Load metadata
    await loadCacheMetadata();
    
    const tracks = cacheMetadata.tracks;
    const trackIds = Object.keys(tracks);
    const totalFiles = trackIds.length;
    
    let totalSizeBytes = 0;
    let oldestEntry = null;
    let newestEntry = null;
    
    for (const trackId of trackIds) {
      const track = tracks[trackId];
      totalSizeBytes += track.fileSizeBytes || 0;
      
      const cachedAt = new Date(track.cachedAt);
      if (!oldestEntry || cachedAt < oldestEntry) {
        oldestEntry = cachedAt;
      }
      if (!newestEntry || cachedAt > newestEntry) {
        newestEntry = cachedAt;
      }
    }
    
    const averageFileSize = totalFiles > 0 ? Math.round(totalSizeBytes / totalFiles) : 0;
    
    // Build list of cached tracks with metadata
    const cachedTracks = trackIds.map(trackId => {
      const track = tracks[trackId];
      return {
        id: trackId,
        title: track.metadata?.title || 'Unknown Track',
        artist: track.metadata?.artist || null,
        cachedAt: track.cachedAt,
        lastAccessed: track.lastAccessed || track.cachedAt,
        fileSizeBytes: track.fileSizeBytes || 0,
        fileSizeMB: track.fileSizeBytes ? Math.round((track.fileSizeBytes / 1048576) * 100) / 100 : 0
      };
    }).sort((a, b) => new Date(b.lastAccessed) - new Date(a.lastAccessed)); // Sort by most recently accessed
    
    const stats = {
      totalFiles: totalFiles,
      totalSizeBytes: totalSizeBytes,
      totalSizeMB: Math.round((totalSizeBytes / 1048576) * 100) / 100,
      maxCacheSizeMB: Math.round((getMaxCacheBytes() / 1048576) * 100) / 100,
      oldestEntry: oldestEntry ? oldestEntry.toISOString() : null,
      newestEntry: newestEntry ? newestEntry.toISOString() : null,
      averageFileSize: averageFileSize,
      version: cacheMetadata.version,
      lastSync: cacheMetadata.lastSync,
      cachedTracks: cachedTracks.slice(0, 50) // Limit to first 50 for performance
    };
    
    // Cache the result
    cacheStatsCache = stats;
    cacheStatsCacheTime = now;
    
    return stats;
  } catch (error) {
    console.error('Error getting cache stats:', error);
    return {
      totalFiles: 0,
      totalSizeBytes: 0,
      totalSizeMB: 0,
      oldestEntry: null,
      newestEntry: null,
      averageFileSize: 0,
      version: '1.0',
      lastSync: null
    };
  }
}

// STEP 37: Verify cache integrity
async function verifyCacheIntegrity() {
  try {
    await loadCacheMetadata();
    
    const issues = [];
    const tracks = cacheMetadata.tracks;
    const trackIds = Object.keys(tracks);
    
    for (const trackId of trackIds) {
      const track = tracks[trackId];
      
      // Check if file exists
      try {
        await fs.access(track.filePath);
      } catch (error) {
        issues.push({
          trackId: trackId,
          issue: 'file_missing',
          message: 'Cached file does not exist on disk'
        });
        // Remove from metadata
        delete tracks[trackId];
        continue;
      }
      
      // Verify checksum (optional - can be slow)
      // For now, we'll skip checksum verification in integrity check
      // It can be done on-demand or periodically
    }
    
    // Save updated metadata if any tracks were removed
    if (issues.length > 0) {
      await saveCacheMetadata();
      cacheStatsCache = null; // Invalidate stats cache
    }
    
    return {
      success: true,
      issues: issues,
      issuesCount: issues.length
    };
  } catch (error) {
    console.error('Error verifying cache integrity:', error);
    return {
      success: false,
      error: error.message,
      issues: [],
      issuesCount: 0
    };
  }
}

async function enforceMaxTrackCount(maxCount = 50) {
  await loadCacheMetadata();
  const entries = Object.entries(cacheMetadata.tracks)
    .map(([id, track]) => ({
      id,
      ms: new Date(track.lastAccessed || track.cachedAt || 0).getTime()
    }))
    .sort((a, b) => b.ms - a.ms);

  if (entries.length <= maxCount) {
    return { deletedCount: 0, kept: entries.length };
  }

  const toRemove = entries.slice(maxCount).map((entry) => entry.id);
  const result = await deleteTracksBatch(toRemove);
  return { deletedCount: result.deletedCount, kept: maxCount };
}

async function pruneOrphanMp3Files() {
  await loadCacheMetadata();
  const cacheDir = getCacheDirectory();
  let deleted = 0;

  let files = [];
  try {
    files = await fs.readdir(cacheDir);
  } catch {
    return { deleted: 0 };
  }

  for (const fileName of files) {
    if (!fileName.toLowerCase().endsWith('.mp3')) continue;
    const trackId = fileName.replace(/\.mp3$/i, '');
    if (cacheMetadata.tracks[trackId]) continue;
    try {
      await fs.unlink(path.join(cacheDir, fileName));
      deleted += 1;
    } catch {
      /* ignore */
    }
  }

  cacheStatsCache = null;
  return { deleted };
}

// Initialize cache directory on module load
getCacheDirectory();

module.exports = {
  getCacheDirectory,
  getCacheMetadataPath,
  getMaxCacheBytes,
  loadCacheMetadata,
  saveCacheMetadata,
  saveTrackToCache,
  getCachedTrack,
  deleteCachedTrack,
  getCacheSize,
  clearCache,
  getCacheStats,
  verifyCacheIntegrity,
  evictLeastRecentlyUsedBytes,
  ensureRoomForIncomingBytes,
  enforceMaxTrackCount,
  pruneOrphanMp3Files
};




