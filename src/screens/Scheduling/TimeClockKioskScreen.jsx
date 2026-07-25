// src/screens/Scheduling/TimeClockKioskScreen.jsx
// Standalone time clock kiosk screen that opens in a separate window
// This screen will not timeout and is designed for tablet use
import React, { useEffect, useMemo } from 'react';
import TimeClockKiosk from '../../components/Scheduling/TimeClockKiosk';
import { useBusiness } from '../../contexts/BusinessContext';
import { useLocation, useParams } from 'react-router-dom';
import {
  DEFAULT_PUNCH_CLOCK_BUSINESS_ID,
  isPunchClockAppHost,
} from '../../utils/employeeAppRouting';

const TimeClockKioskScreen = () => {
  const { businessId: routeBusinessId } = useParams();
  const location = useLocation();
  const { business, setBusiness } = useBusiness();
  const queryBusinessId = useMemo(
    () => new URLSearchParams(location.search).get('business'),
    [location.search]
  );
  const explicitBusinessId = routeBusinessId || queryBusinessId;
  const resolvedBusinessId =
    explicitBusinessId ||
    (isPunchClockAppHost() ? DEFAULT_PUNCH_CLOCK_BUSINESS_ID : null) ||
    business?.id;

  useEffect(() => {
    if (explicitBusinessId && business?.id !== explicitBusinessId) {
      setBusiness(explicitBusinessId);
    }
  }, [business?.id, explicitBusinessId, setBusiness]);

  /** Kiosk must run as the top-level document; embedding (iframe / some tablet shells) breaks navigation and can pair with Chrome’s internal error page (chrome-error://). */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (window.self !== window.top) {
        window.top.location.href = window.location.href;
      }
    } catch {
      /* cross-origin parent — cannot break out; open this URL in a full browser tab/window */
    }
  }, []);

  if (!resolvedBusinessId) {
    return (
      <div style={styles.empty}>
        <h1 style={styles.title}>Business Required</h1>
        <p style={styles.text}>
          Open the time clock kiosk from Scheduling Settings so the correct business is included in the kiosk link.
        </p>
      </div>
    );
  }

  return <TimeClockKiosk businessId={resolvedBusinessId} />;
};

const styles = {
  empty: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px',
    backgroundColor: '#f8fafc',
    textAlign: 'center'
  },
  title: {
    margin: 0,
    marginBottom: '10px',
    color: '#111827'
  },
  text: {
    margin: 0,
    maxWidth: '520px',
    color: '#4b5563',
    lineHeight: 1.6
  }
};

export default TimeClockKioskScreen;
