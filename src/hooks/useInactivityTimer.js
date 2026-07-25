// Hook for inactivity timing in public waiver flows.
import { useState, useEffect, useRef } from 'react';

/**
 * @param {function} onTimeout
 * @param {number} [timeoutSeconds]
 * @param {function|null} [onWarning]
 * @param {{ enabled?: boolean, warningSeconds?: number }} [options] When enabled is false, countdown and timeout are paused (e.g. full-screen kiosk idle ads).
 */
export const useInactivityTimer = (onTimeout, timeoutSeconds = 30, onWarning = null, options = {}) => {
  const { enabled = true, warningSeconds = 10 } = options;
  const [timeRemaining, setTimeRemaining] = useState(timeoutSeconds);
  const [showWarning, setShowWarning] = useState(false);
  const timerRef = useRef(null);
  const warningShownRef = useRef(false);
  const timeoutFiredForZeroRef = useRef(false);
  const onTimeoutRef = useRef(onTimeout);
  const onWarningRef = useRef(onWarning);

  onTimeoutRef.current = onTimeout;
  onWarningRef.current = onWarning;

  const resetTimer = () => {
    setTimeRemaining(timeoutSeconds);
    setShowWarning(false);
    warningShownRef.current = false;
    timeoutFiredForZeroRef.current = false;
  };

  // When enabled (or kiosk config) changes while active, restart the countdown from full duration.
  useEffect(() => {
    if (!enabled) return;
    setTimeRemaining(timeoutSeconds);
    setShowWarning(false);
    warningShownRef.current = false;
    timeoutFiredForZeroRef.current = false;
  }, [enabled, timeoutSeconds]);

  useEffect(() => {
    if (!enabled) return;
    const handleInteraction = () => {
      setTimeRemaining(timeoutSeconds);
      setShowWarning(false);
      warningShownRef.current = false;
      timeoutFiredForZeroRef.current = false;
    };

    window.addEventListener('mousedown', handleInteraction);
    window.addEventListener('mousemove', handleInteraction);
    window.addEventListener('touchstart', handleInteraction);
    window.addEventListener('touchmove', handleInteraction);
    window.addEventListener('keydown', handleInteraction);
    window.addEventListener('scroll', handleInteraction);
    window.addEventListener('click', handleInteraction);

    return () => {
      window.removeEventListener('mousedown', handleInteraction);
      window.removeEventListener('mousemove', handleInteraction);
      window.removeEventListener('touchstart', handleInteraction);
      window.removeEventListener('touchmove', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
      window.removeEventListener('scroll', handleInteraction);
      window.removeEventListener('click', handleInteraction);
    };
  }, [enabled, timeoutSeconds]);

  // When countdown hits zero: notify outside React's render/setState updater (never call parent setState from a child state updater).
  useEffect(() => {
    if (!enabled) return;
    if (timeRemaining > 0) {
      timeoutFiredForZeroRef.current = false;
      return;
    }

    if (timeoutFiredForZeroRef.current) return;
    timeoutFiredForZeroRef.current = true;

    queueMicrotask(() => {
      onTimeoutRef.current?.();
    });
  }, [timeRemaining, enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (timeRemaining <= 0) {
      return;
    }

    if (warningSeconds > 0 && timeRemaining <= warningSeconds && !warningShownRef.current) {
      setShowWarning(true);
      warningShownRef.current = true;
      onWarningRef.current?.(timeRemaining);
    }

    timerRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [timeRemaining, warningSeconds, enabled]);

  return { timeRemaining, resetTimer, showWarning, setShowWarning };
};
