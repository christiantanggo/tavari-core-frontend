import React, { useCallback, useEffect, useState } from 'react';
import {
  isSignageFullscreen,
  requestSignageFullscreen
} from '../../utils/signageFullscreen';

/**
 * Auto-fullscreen + tap-to-enter prompt for browser waiver kiosks (hides URL bar).
 */
const WaiverKioskFullscreenOverlay = ({ enabled = true }) => {
  const [needsFullscreenTap, setNeedsFullscreenTap] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const enterFullscreen = useCallback(async () => {
    const ok = await requestSignageFullscreen();
    setIsFullscreen(isSignageFullscreen());
    setNeedsFullscreenTap(!ok && !isSignageFullscreen());
    return ok;
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    document.documentElement.classList.add('waiver-kiosk-fullscreen-root');
    document.body.classList.add('waiver-kiosk-fullscreen-root');
    document.body.style.margin = '0';

    const sync = () => setIsFullscreen(isSignageFullscreen());
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    sync();

    enterFullscreen().then((ok) => {
      if (!ok) setNeedsFullscreenTap(true);
    });

    return () => {
      document.documentElement.classList.remove('waiver-kiosk-fullscreen-root');
      document.body.classList.remove('waiver-kiosk-fullscreen-root');
      document.body.style.margin = '';
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, [enabled, enterFullscreen]);

  if (!enabled || !needsFullscreenTap || isFullscreen) return null;

  return (
    <button
      type="button"
      onClick={() => enterFullscreen()}
      style={styles.prompt}
    >
      Tap for fullscreen (hide browser bars)
    </button>
  );
};

const styles = {
  prompt: {
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
    zIndex: 100000
  }
};

export default WaiverKioskFullscreenOverlay;
