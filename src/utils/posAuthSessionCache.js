const TTL_MS = 5 * 60 * 1000;

let posAuthCache = null;
let permissionsCache = null;

function isExpired(entry) {
  return !entry || Date.now() > entry.expiresAt;
}

export function getBootstrapBusinessId() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('currentBusinessId') || localStorage.getItem('selectedBusinessId');
}

export function getPosAuthSessionCache(businessId) {
  if (!businessId || isExpired(posAuthCache) || posAuthCache.businessId !== businessId) {
    return null;
  }
  return posAuthCache.payload;
}

export function setPosAuthSessionCache(businessId, payload) {
  if (!businessId || !payload) return;
  posAuthCache = {
    businessId,
    expiresAt: Date.now() + TTL_MS,
    payload,
  };
}

export function clearPosAuthSessionCache(businessId = null) {
  if (!businessId || posAuthCache?.businessId === businessId) {
    posAuthCache = null;
  }
}

export function getPermissionsSessionCache(businessId) {
  if (!businessId || isExpired(permissionsCache) || permissionsCache.businessId !== businessId) {
    return null;
  }
  return permissionsCache.payload;
}

export function setPermissionsSessionCache(businessId, payload) {
  if (!businessId || !payload) return;
  permissionsCache = {
    businessId,
    expiresAt: Date.now() + TTL_MS,
    payload,
  };
}

export function clearPermissionsSessionCache(businessId = null) {
  if (!businessId || permissionsCache?.businessId === businessId) {
    permissionsCache = null;
  }
}

export function clearAllPosSessionCaches(businessId = null) {
  clearPosAuthSessionCache(businessId);
  clearPermissionsSessionCache(businessId);
}
