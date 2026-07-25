import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BOOKING_SLOT_HOLD_HEARTBEAT_MS,
  BOOKING_SLOT_HOLD_IDLE_SECONDS,
  BOOKING_SLOT_HOLD_MAX_SECONDS,
  BOOKING_SLOT_HOLD_TOUCH_THROTTLE_MS,
  releaseBookingSlotHold,
  touchBookingSlotHold,
} from '../helpers/Bookings/bookingSlotHold';

/**
 * Keeps a portal checkout slot hold alive with heartbeat + user-activity touches.
 * Calls onExpired when the hold is released (10 min max or 2 min idle).
 */
export function useBookingSlotHold({ holdToken, active = false, onExpired }) {
  const [secondsRemaining, setSecondsRemaining] = useState(BOOKING_SLOT_HOLD_MAX_SECONDS);
  const [idleSecondsLeft, setIdleSecondsLeft] = useState(BOOKING_SLOT_HOLD_IDLE_SECONDS);
  const lastTouchRef = useRef(Date.now());
  const lastServerTouchRef = useRef(0);
  const onExpiredRef = useRef(onExpired);
  const expiredRef = useRef(false);

  useEffect(() => {
    onExpiredRef.current = onExpired;
  }, [onExpired]);

  const markLocalActivity = useCallback(() => {
    lastTouchRef.current = Date.now();
    setIdleSecondsLeft(BOOKING_SLOT_HOLD_IDLE_SECONDS);
  }, []);

  const expireHold = useCallback(
    async (reason) => {
      if (expiredRef.current) return;
      expiredRef.current = true;
      if (holdToken) {
        try {
          await releaseBookingSlotHold(holdToken);
        } catch {
          /* best effort */
        }
      }
      onExpiredRef.current?.(reason);
    },
    [holdToken]
  );

  const sendTouch = useCallback(async () => {
    if (!holdToken || !active || expiredRef.current) return;
    const now = Date.now();
    if (now - lastServerTouchRef.current < BOOKING_SLOT_HOLD_TOUCH_THROTTLE_MS) return;
    lastServerTouchRef.current = now;
    try {
      const result = await touchBookingSlotHold(holdToken);
      if (!result?.ok) {
        await expireHold(result?.reason || 'expired');
        return;
      }
      if (Number.isFinite(result.seconds_remaining)) {
        setSecondsRemaining(result.seconds_remaining);
      }
    } catch {
      /* ignore transient network errors; local idle timer still applies */
    }
  }, [holdToken, active, expireHold]);

  useEffect(() => {
    if (!active || !holdToken) {
      expiredRef.current = false;
      setSecondsRemaining(BOOKING_SLOT_HOLD_MAX_SECONDS);
      setIdleSecondsLeft(BOOKING_SLOT_HOLD_IDLE_SECONDS);
      return undefined;
    }

    expiredRef.current = false;
    lastTouchRef.current = Date.now();
    lastServerTouchRef.current = 0;
    markLocalActivity();
    sendTouch();

    const activityEvents = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'mousemove'];
    const onActivity = () => {
      markLocalActivity();
      sendTouch();
    };
    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, onActivity, { passive: true });
    });

    const tick = setInterval(() => {
      setSecondsRemaining((prev) => {
        const next = Math.max(0, prev - 1);
        if (next <= 0) {
          expireHold('expired');
        }
        return next;
      });

      const idleElapsedSec = Math.floor((Date.now() - lastTouchRef.current) / 1000);
      const idleLeft = Math.max(0, BOOKING_SLOT_HOLD_IDLE_SECONDS - idleElapsedSec);
      setIdleSecondsLeft(idleLeft);
      if (idleLeft <= 0) {
        expireHold('idle');
      }
    }, 1000);

    const heartbeat = setInterval(() => {
      sendTouch();
    }, BOOKING_SLOT_HOLD_HEARTBEAT_MS);

    return () => {
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, onActivity);
      });
      clearInterval(tick);
      clearInterval(heartbeat);
    };
  }, [active, holdToken, expireHold, markLocalActivity, sendTouch]);

  return {
    secondsRemaining,
    idleSecondsLeft,
    markLocalActivity,
    releaseHold: () => expireHold('manual'),
  };
}
