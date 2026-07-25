// After reviewing an on-file waiver: guest-facing handoff to the front desk.
// Waiver PII must not be reachable via browser Back — see history + popstate handling.
import React, { useEffect, useRef } from 'react';
import { FiCheckCircle } from 'react-icons/fi';
import { TavariStyles } from '../../../utils/TavariStyles';

const TAVARI_WAIVER_CHECKIN_BARRIER = '__tavariWaiverCheckInBarrier';

const ExistingWaiverCheckInStep = ({ onDone }) => {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    try {
      window.history.pushState(
        { [TAVARI_WAIVER_CHECKIN_BARRIER]: true },
        '',
        window.location.href
      );
    } catch (_) {
      /* ignore */
    }

    const onPopState = () => {
      const fn = onDoneRef.current;
      if (typeof fn === 'function') fn();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <FiCheckCircle size={72} style={styles.icon} aria-hidden />
        <h1 style={styles.title}>Your waiver is ready to use</h1>
        <p style={styles.message}>
          Please go to the front desk. A team member will finish check-in for your visit.
        </p>
        <p style={styles.privacyNote}>
          Your waiver details are hidden now for privacy. You can leave this screen when you are ready to return
          the kiosk to the start page.
        </p>
        <button type="button" onClick={onDone} style={styles.button}>
          Return to start
        </button>
      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem',
    backgroundColor: TavariStyles.colors.background,
    boxSizing: 'border-box'
  },
  card: {
    width: '100%',
    maxWidth: '520px',
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: '2.5rem 2rem',
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    boxShadow: `0 0 0 1px ${TavariStyles.colors.gray200}, ${TavariStyles.shadows.lg}`,
    textAlign: 'center'
  },
  icon: {
    color: '#10B981',
    marginBottom: '1.25rem'
  },
  title: {
    fontSize: '1.75rem',
    fontWeight: '700',
    color: TavariStyles.colors.text,
    margin: '0 0 1rem 0',
    lineHeight: 1.3
  },
  message: {
    fontSize: '1.125rem',
    color: TavariStyles.colors.gray600,
    lineHeight: 1.55,
    margin: '0 0 1rem 0'
  },
  privacyNote: {
    fontSize: '0.875rem',
    color: TavariStyles.colors.gray600,
    lineHeight: 1.5,
    margin: '0 0 1.75rem 0',
    padding: '0.75rem 1rem',
    backgroundColor: '#F9FAFB',
    borderRadius: TavariStyles.borderRadius.md,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    textAlign: 'left'
  },
  button: {
    padding: '1rem 2.5rem',
    fontSize: '1.0625rem',
    fontWeight: '600',
    color: TavariStyles.colors.white,
    backgroundColor: TavariStyles.colors.primary,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    width: '100%',
    maxWidth: '280px'
  }
};

export default ExistingWaiverCheckInStep;
