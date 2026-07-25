// Public digital signage player — fullscreen playback for TVs, tablets, Fire sticks.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import SignagePairingPanel from '../../components/DigitalSignage/SignagePairingPanel';
import SignagePlayerCarousel from '../../components/DigitalSignage/SignagePlayerCarousel';
import SignageZoneLayout from '../../components/DigitalSignage/SignageZoneLayout';
import {
  fetchPlayerState,
  flattenManifestItems,
  getStoredScreenKey,
  getCachedPlayerManifest,
  storeScreenKey,
  storePlayerManifest,
  clearStoredScreenKey,
  syncScreenKeyToUrl
} from '../../services/SignagePlayerService';
import { normalizeScreenKeyInput } from '../../utils/signageScreenKey';
import { normalizeSignageContentFit } from '../../utils/signageContentFit';
import { prefetchManifestItems } from '../../utils/signageOfflineCache';
import {
  isSignageFullscreen,
  requestSignageFullscreen,
  exitSignageFullscreen
} from '../../utils/signageFullscreen';

function formatRemainingTime(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

const SignagePlayerScreen = () => {
  const [searchParams] = useSearchParams();
  const initialScreenKeyRef = useRef(null);
  if (initialScreenKeyRef.current === null) {
    const fromUrl = searchParams.get('screen_key') || searchParams.get('screenKey') || '';
    const normalized = normalizeScreenKeyInput(fromUrl);
    initialScreenKeyRef.current = normalized || normalizeScreenKeyInput(getStoredScreenKey());
  }

  const initialScreenKey = initialScreenKeyRef.current;
  const initialManifest = initialScreenKey ? getCachedPlayerManifest(initialScreenKey) : null;

  const [screenKey, setScreenKey] = useState(initialScreenKey);
  const [playerState, setPlayerState] = useState(initialManifest);
  const [loading, setLoading] = useState(!initialManifest);
  const [error, setError] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [needsFullscreenTap, setNeedsFullscreenTap] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const manifestRef = useRef(initialManifest?.manifestVersion ?? null);
  const pollRef = useRef(null);
  const playerStateRef = useRef(null);

  useEffect(() => {
    playerStateRef.current = playerState;
  }, [playerState]);

  useEffect(() => {
    if (initialScreenKey) {
      syncScreenKeyToUrl(initialScreenKey);
    }
  }, [initialScreenKey]);

  const loadState = useCallback(async (key, { silent = false } = {}) => {
    const k = normalizeScreenKeyInput(key);
    if (!k) return;

    const cachedManifest = getCachedPlayerManifest(k);

    if (!silent) {
      setLoading(!playerStateRef.current && !cachedManifest);
      setError('');
    }

    try {
      const state = await fetchPlayerState(k);
      setPlayerState(state);
      storeScreenKey(k);
      storePlayerManifest(k, state);
      setError('');

      const allItems = flattenManifestItems(state);
      if (state.manifestVersion !== manifestRef.current) {
        manifestRef.current = state.manifestVersion;
        setSyncStatus('Syncing content…');
        const count = await prefetchManifestItems(allItems);
        setSyncStatus(count > 0 ? `Cached ${count} item(s)` : '');
        setTimeout(() => setSyncStatus(''), 4000);
      }
    } catch (err) {
      const msg = err?.message || 'Could not load signage content';
      const fallback = playerStateRef.current || cachedManifest;

      if (fallback) {
        if (!playerStateRef.current && cachedManifest) {
          setPlayerState(cachedManifest);
        }
        setError('');
        setSyncStatus(
          silent ? 'Offline — playing cached content' : 'Using saved playlist — reconnecting…'
        );
        setTimeout(() => setSyncStatus(''), silent ? 3000 : 5000);
      } else if (!silent) {
        setError(msg);
        setPlayerState(null);
      } else {
        setError(msg);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!screenKey) return undefined;

    loadState(screenKey);

    pollRef.current = setInterval(() => {
      loadState(screenKey, { silent: true });
    }, 60000);

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        loadState(screenKey, { silent: true });
      }
    };
    const onPageShow = (event) => {
      if (event.persisted || document.visibilityState === 'visible') {
        loadState(screenKey, { silent: true });
      }
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onPageShow);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [screenKey, loadState]);

  useEffect(() => {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.margin = '0';
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, []);

  const enterFullscreen = useCallback(async () => {
    const ok = await requestSignageFullscreen();
    setIsFullscreen(isSignageFullscreen());
    setNeedsFullscreenTap(!ok && !isSignageFullscreen());
    return ok;
  }, []);

  useEffect(() => {
    const sync = () => setIsFullscreen(isSignageFullscreen());
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    sync();
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  useEffect(() => {
    if (!screenKey) return;
    enterFullscreen().then((ok) => {
      if (!ok) setNeedsFullscreenTap(true);
    });
  }, [screenKey, enterFullscreen]);

  const handlePair = async (key) => {
    const normalized = normalizeScreenKeyInput(key);
    setScreenKey(normalized);
    storeScreenKey(normalized);
    setError('');
    await enterFullscreen();
  };

  const handleUnpair = () => {
    clearStoredScreenKey();
    setScreenKey('');
    setPlayerState(null);
    setShowSettings(false);
    manifestRef.current = null;
  };

  if (!screenKey) {
    return <SignagePairingPanel onPair={handlePair} error={error} loading={loading} />;
  }

  const hasZones = playerState?.layout === 'zones' && (playerState?.zones?.length ?? 0) > 0;
  const hasPlaylist = (playerState?.playlist?.length ?? 0) > 0;
  const shufflePlayback = !!playerState?.shufflePlaylist;
  const bookingOverride = playerState?.bookingOverride || null;
  const contentFit = normalizeSignageContentFit(
    playerState?.screen?.contentFit ?? playerState?.screen?.settings?.contentFit
  );

  if (loading && !playerState) {
    return (
      <div style={styles.center}>
        <p style={styles.message}>Loading signage…</p>
      </div>
    );
  }

  if (error && !playerState) {
    return (
      <div>
        <SignagePairingPanel onPair={handlePair} error={error} loading={loading} />
        {screenKey ? (
          <div style={{ textAlign: 'center', paddingBottom: '2rem' }}>
            <button type="button" style={styles.tryDifferent} onClick={handleUnpair}>
              Try a different screen key
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div style={styles.root}>
      {hasZones ? (
        <SignageZoneLayout
          zones={playerState.zones}
          defaultSlideSeconds={playerState.defaultSlideSeconds}
          fillMode={contentFit}
          shuffle={shufflePlayback}
        />
      ) : hasPlaylist ? (
        <SignagePlayerCarousel
          items={playerState.playlist}
          defaultSlideSeconds={playerState.defaultSlideSeconds}
          fillMode={contentFit}
          shuffle={shufflePlayback}
        />
      ) : (
        <div style={styles.center}>
          <p style={styles.message}>No content scheduled</p>
          <p style={styles.subMessage}>
            {playerState?.screen?.name || 'Screen'} is connected. Assign a schedule in Digital Signage.
          </p>
        </div>
      )}

      {syncStatus ? (
        <div style={styles.syncBadge}>{syncStatus}</div>
      ) : null}

      {bookingOverride ? (
        <div style={styles.bookingBadge}>
          <div style={styles.bookingTitle}>
            {bookingOverride.activityName || 'Party booking'}
          </div>
          <div style={styles.bookingCountdown}>
            {formatRemainingTime(bookingOverride.remainingSeconds)}
          </div>
          {bookingOverride.extendedMinutes ? (
            <div style={styles.bookingMeta}>Extended {bookingOverride.extendedMinutes} min</div>
          ) : null}
        </div>
      ) : null}

      {needsFullscreenTap && !isFullscreen ? (
        <button
          type="button"
          style={styles.fullscreenPrompt}
          onClick={() => enterFullscreen()}
        >
          Tap for fullscreen (hide browser bars)
        </button>
      ) : null}

      <button
        type="button"
        style={styles.settingsHit}
        aria-label="Player settings"
        onClick={() => setShowSettings((v) => !v)}
      />

      {showSettings ? (
        <div style={styles.settingsPanel}>
          <p style={styles.settingsTitle}>{playerState?.screen?.name || 'Signage player'}</p>
          {playerState?.schedule?.name ? (
            <p style={styles.settingsLine}>Schedule: {playerState.schedule.name}</p>
          ) : null}
          <p style={styles.settingsLine}>Key: {screenKey}</p>
          <button
            type="button"
            style={styles.closeBtn}
            onClick={() => (isFullscreen ? exitSignageFullscreen() : enterFullscreen())}
          >
            {isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          </button>
          <button type="button" style={styles.unpairBtn} onClick={handleUnpair}>
            Disconnect screen
          </button>
          <button type="button" style={styles.closeBtn} onClick={() => setShowSettings(false)}>
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
};

const styles = {
  root: {
    position: 'fixed',
    inset: 0,
    backgroundColor: '#000',
    overflow: 'hidden'
  },
  center: {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
    color: '#fff',
    padding: '2rem',
    textAlign: 'center'
  },
  message: {
    fontSize: '1.5rem',
    fontWeight: 600,
    margin: 0
  },
  subMessage: {
    fontSize: '1rem',
    color: '#9ca3af',
    marginTop: '0.75rem',
    maxWidth: '480px'
  },
  syncBadge: {
    position: 'fixed',
    bottom: '1rem',
    right: '1rem',
    padding: '0.5rem 1rem',
    backgroundColor: 'rgba(0,0,0,0.65)',
    color: '#fff',
    borderRadius: '8px',
    fontSize: '0.85rem',
    zIndex: 1000
  },
  bookingBadge: {
    position: 'fixed',
    top: '1rem',
    left: '1rem',
    padding: '0.85rem 1.1rem',
    backgroundColor: 'rgba(15,23,42,0.86)',
    color: '#fff',
    borderRadius: '12px',
    zIndex: 1000,
    minWidth: '190px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.25)'
  },
  bookingTitle: {
    fontSize: '0.9rem',
    fontWeight: 700,
    marginBottom: '0.25rem'
  },
  bookingCountdown: {
    fontSize: '2rem',
    lineHeight: 1,
    fontWeight: 800,
    letterSpacing: '0.02em'
  },
  bookingMeta: {
    marginTop: '0.35rem',
    color: '#cbd5e1',
    fontSize: '0.8rem'
  },
  fullscreenPrompt: {
    position: 'fixed',
    bottom: '1rem',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '0.65rem 1.25rem',
    backgroundColor: 'rgba(15,23,42,0.92)',
    color: '#fff',
    border: '1px solid #475569',
    borderRadius: '999px',
    fontSize: '0.9rem',
    cursor: 'pointer',
    zIndex: 1000
  },
  settingsHit: {
    position: 'fixed',
    top: 0,
    right: 0,
    width: '48px',
    height: '48px',
    opacity: 0,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    zIndex: 1001
  },
  settingsPanel: {
    position: 'fixed',
    top: '1rem',
    right: '1rem',
    backgroundColor: 'rgba(15,23,42,0.92)',
    color: '#fff',
    padding: '1rem 1.25rem',
    borderRadius: '10px',
    zIndex: 1002,
    minWidth: '220px',
    fontSize: '0.875rem'
  },
  settingsTitle: {
    margin: '0 0 0.5rem',
    fontWeight: 700,
    fontSize: '1rem'
  },
  settingsLine: {
    margin: '0.25rem 0',
    color: '#cbd5e1',
    wordBreak: 'break-all'
  },
  unpairBtn: {
    marginTop: '0.75rem',
    width: '100%',
    padding: '0.5rem',
    backgroundColor: '#dc2626',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 600
  },
  closeBtn: {
    marginTop: '0.5rem',
    width: '100%',
    padding: '0.5rem',
    backgroundColor: '#334155',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  tryDifferent: {
    padding: '0.65rem 1.25rem',
    backgroundColor: 'transparent',
    color: '#94a3b8',
    border: '1px solid #475569',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.9rem'
  }
};

export default SignagePlayerScreen;
