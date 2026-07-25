// Full-screen waiver kiosk attract carousel: auto-advance, arrows, dots.
import React, { useCallback, useEffect, useState } from 'react';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import { clampKioskAdSlideSeconds } from '../../constants/waiverKioskIdleAds';

/**
 * @param {{ id: string, name: string, imageUrl: string }[]} ads
 * @param {number} initialIndex
 * @param {number} slideSeconds raw from waiver_settings (clamped inside)
 * @param {function} onDismiss
 */
const KioskIdleAdCarousel = ({
  ads,
  initialIndex = 0,
  slideSeconds = 8,
  onDismiss,
  onImageError
}) => {
  const safeLen = Array.isArray(ads) ? ads.length : 0;
  const [index, setIndex] = useState(0);
  const [manualEpoch, setManualEpoch] = useState(0);

  const seconds = clampKioskAdSlideSeconds(slideSeconds);

  useEffect(() => {
    if (safeLen <= 0) return;
    setIndex(((initialIndex % safeLen) + safeLen) % safeLen);
  }, [initialIndex, safeLen]);

  useEffect(() => {
    if (safeLen <= 1) return;
    const ms = seconds * 1000;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % safeLen);
    }, ms);
    return () => clearInterval(id);
  }, [safeLen, seconds, manualEpoch]);

  const bumpManual = useCallback(() => setManualEpoch((e) => e + 1), []);

  const go = useCallback(
    (delta) => {
      bumpManual();
      setIndex((i) => (i + delta + safeLen) % safeLen);
    },
    [safeLen, bumpManual]
  );

  const stop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleBackdropPointer = useCallback(
    (e) => {
      if (e?.target?.closest?.('[data-kiosk-idle-control="1"]')) return;
      onDismiss(e);
    },
    [onDismiss]
  );

  if (!safeLen) return null;

  const ad = ads[index];
  if (!ad?.imageUrl) return null;

  const showChrome = safeLen > 1;

  return (
    <div
      role="presentation"
      style={styles.overlay}
      onClick={handleBackdropPointer}
      onTouchEnd={handleBackdropPointer}
    >
      <img
        src={ad.imageUrl}
        alt={ad.name || 'Promotional image'}
        style={styles.image}
        draggable={false}
        onError={() => onImageError?.(ad)}
      />

      {showChrome ? (
        <>
          <button
            type="button"
            data-kiosk-idle-control="1"
            aria-label="Previous image"
            style={styles.arrowLeft}
            onClick={(e) => {
              stop(e);
              go(-1);
            }}
            onTouchEnd={(e) => {
              stop(e);
              go(-1);
            }}
          >
            <FiChevronLeft size={36} color="#fff" />
          </button>
          <button
            type="button"
            data-kiosk-idle-control="1"
            aria-label="Next image"
            style={styles.arrowRight}
            onClick={(e) => {
              stop(e);
              go(1);
            }}
            onTouchEnd={(e) => {
              stop(e);
              go(1);
            }}
          >
            <FiChevronRight size={36} color="#fff" />
          </button>

          <div
            role="tablist"
            aria-label="Advertisement slides"
            data-kiosk-idle-control="1"
            style={styles.dotsRow}
            onClick={stop}
            onTouchEnd={stop}
          >
            {ads.map((_, i) => (
              <button
                key={ads[i].id || i}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Slide ${i + 1} of ${safeLen}`}
                data-kiosk-idle-control="1"
                style={{
                  ...styles.dot,
                  ...(i === index ? styles.dotActive : styles.dotInactive)
                }}
                onClick={(e) => {
                  stop(e);
                  bumpManual();
                  setIndex(i);
                }}
              />
            ))}
          </div>
        </>
      ) : null}

      <div style={styles.prompt}>Tap anywhere to start your waiver</div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: '#000',
    zIndex: 99999,
    cursor: 'pointer',
    overflow: 'hidden'
  },
  image: {
    width: '100vw',
    height: '100vh',
    objectFit: 'cover',
    display: 'block',
    backgroundColor: '#000'
  },
  arrowLeft: {
    position: 'absolute',
    left: 0,
    top: '50%',
    transform: 'translateY(-50%)',
    width: 'min(72px, 14vw)',
    height: 'min(120px, 22vh)',
    borderWidth: 0,
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: '0 12px 12px 0',
    backgroundColor: 'rgba(0,0,0,0.45)',
    backgroundImage: 'none',
    backgroundRepeat: 'repeat',
    backgroundPosition: '0% 0%',
    backgroundSize: 'auto',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100000,
    padding: 0
  },
  arrowRight: {
    position: 'absolute',
    right: 0,
    top: '50%',
    transform: 'translateY(-50%)',
    width: 'min(72px, 14vw)',
    height: 'min(120px, 22vh)',
    borderWidth: 0,
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: '12px 0 0 12px',
    backgroundColor: 'rgba(0,0,0,0.45)',
    backgroundImage: 'none',
    backgroundRepeat: 'repeat',
    backgroundPosition: '0% 0%',
    backgroundSize: 'auto',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100000,
    padding: 0
  },
  dotsRow: {
    position: 'absolute',
    left: '50%',
    bottom: '5.5rem',
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'row',
    gap: '0.55rem',
    alignItems: 'center',
    zIndex: 100000,
    padding: '0.35rem 0.75rem',
    borderRadius: '999px',
    backgroundColor: 'rgba(0,0,0,0.35)',
    backgroundImage: 'none',
    backgroundRepeat: 'repeat',
    backgroundPosition: '0% 0%',
    backgroundSize: 'auto'
  },
  dot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: 'rgba(255,255,255,0.85)',
    padding: 0,
    cursor: 'pointer',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    backgroundRepeat: 'repeat',
    backgroundPosition: '0% 0%',
    backgroundSize: 'auto'
  },
  dotInactive: {
    opacity: 0.55
  },
  dotActive: {
    opacity: 1,
    backgroundColor: TavariStyles.colors.white,
    borderColor: TavariStyles.colors.white,
    transform: 'scale(1.15)'
  },
  prompt: {
    position: 'absolute',
    left: '50%',
    bottom: '2rem',
    transform: 'translateX(-50%)',
    padding: '0.9rem 1.4rem',
    borderRadius: '999px',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    color: '#ffffff',
    fontSize: '1.1rem',
    fontWeight: 700,
    letterSpacing: '0.01em',
    textAlign: 'center',
    maxWidth: '92vw',
    pointerEvents: 'none',
    zIndex: 99998
  }
};

export default KioskIdleAdCarousel;
