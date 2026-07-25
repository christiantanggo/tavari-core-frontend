// build/electron/sessionManager.cjs
// Manages session persistence for headless mini PC installations
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const SESSION_FILE = path.join(app.getPath('userData'), 'tavari-session.json');
const SESSION_BACKUP_FILE = path.join(app.getPath('userData'), 'tavari-session.backup.json');

function writeJsonAtomic(filePath, data) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filePath);
}

function readSessionFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.warn(`⚠️ Failed to read session file ${filePath}:`, error.message);
    return null;
  }
}

function readExistingSession() {
  return readSessionFile(SESSION_FILE) || readSessionFile(SESSION_BACKUP_FILE);
}

/**
 * Save session data for auto-login
 * Also saves business_id for headless kiosk operation
 */
function saveSession(sessionData) {
  try {
    if (!sessionData || typeof sessionData !== 'object') {
      return false;
    }

    const existingSession = readExistingSession();
    const pinnedBusinessId =
      sessionData.pinned_business_id ||
      sessionData.pinnedBusinessId ||
      existingSession?.pinned_business_id ||
      sessionData.business_id ||
      existingSession?.business_id ||
      null;

    const businessId =
      sessionData.business_id ||
      sessionData.businessId ||
      pinnedBusinessId ||
      existingSession?.business_id ||
      null;

    const data = {
      access_token: sessionData.access_token || existingSession?.access_token || null,
      refresh_token: sessionData.refresh_token || existingSession?.refresh_token || null,
      expires_at: sessionData.expires_at || existingSession?.expires_at || null,
      user: sessionData.user || existingSession?.user || null,
      business_id: businessId, // CRITICAL: Save business ID for kiosk
      pinned_business_id: pinnedBusinessId,
      savedAt: new Date().toISOString()
    };

    if (!data.business_id && !data.pinned_business_id && !data.access_token && !data.refresh_token) {
      console.warn('⚠️ Refusing to save empty kiosk session');
      return false;
    }
    
    writeJsonAtomic(SESSION_FILE, data);
    writeJsonAtomic(SESSION_BACKUP_FILE, data);
    console.log('✅ Session and business ID saved for auto-login (primary + backup)');
    return true;
  } catch (error) {
    console.error('❌ Failed to save session:', error);
    return false;
  }
}

/**
 * Load saved session
 */
function loadSession() {
  try {
    const session = readExistingSession();
    if (!session) return null;

    // Never discard saved credentials just because the *access* token's expires_at
    // is in the past. Supabase rotates access tokens often; refresh_token + setSession
    // restores a valid session on cold start (required after nightly kiosk restart).
    if (!session.refresh_token && !session.access_token) {
      if (session.business_id || session.pinned_business_id) {
        console.log('ℹ️ Saved kiosk session has business ID only; music can still start by pinned business');
        return session;
      }
      console.log('⚠️ Saved session has no tokens or business ID');
      return null;
    }

    if (session.expires_at && new Date(session.expires_at * 1000) < new Date()) {
      console.log(
        'ℹ️ Saved access token expiry is past — restore will use refresh_token if still valid'
      );
    }

    return session;
  } catch (error) {
    console.error('❌ Failed to load session:', error);
    return null;
  }
}

/**
 * Clear saved session
 */
function clearSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      fs.unlinkSync(SESSION_FILE);
      console.log('✅ Session cleared');
    }
    if (fs.existsSync(SESSION_BACKUP_FILE)) {
      fs.unlinkSync(SESSION_BACKUP_FILE);
      console.log('✅ Backup session cleared');
    }
    return true;
  } catch (error) {
    console.error('❌ Failed to clear session:', error);
    return false;
  }
}

module.exports = {
  saveSession,
  loadSession,
  clearSession,
  SESSION_FILE,
  SESSION_BACKUP_FILE
};

