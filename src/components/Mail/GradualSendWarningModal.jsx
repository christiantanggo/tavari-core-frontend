import React from 'react';
import { FiAlertTriangle, FiX } from 'react-icons/fi';

const GradualSendWarningModal = ({
  open,
  onCancel,
  onConfirm,
  campaignName,
  queueHealth,
  remainingToQueue,
}) => {
  if (!open) return null;

  const sent = queueHealth?.sent ?? 0;
  const pending = queueHealth?.pending ?? 0;

  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="gradual-resend-title">
      <div style={styles.modal}>
        <button type="button" style={styles.close} onClick={onCancel} aria-label="Close">
          <FiX size={20} />
        </button>
        <div style={styles.iconRow}>
          <FiAlertTriangle size={28} color="#b45309" />
          <h2 id="gradual-resend-title" style={styles.title}>
            This campaign is already sending
          </h2>
        </div>
        <p style={styles.body}>
          <strong>{campaignName}</strong> already has gradual or background sending in progress.
        </p>
        <ul style={styles.list}>
          <li>
            <strong>{sent}</strong> recipient(s) already sent
          </li>
          <li>
            <strong>{pending}</strong> still queued or processing
          </li>
          <li>
            Re-starting will queue up to <strong>{remainingToQueue}</strong> contacts who have not been sent yet
          </li>
        </ul>
        <p style={styles.warning}>
          Starting again does <strong>not</strong> email people who already received this campaign. It only adds queue
          rows for unsent contacts. If you need a full resend to everyone, create a new campaign.
        </p>
        <div style={styles.actions}>
          <button type="button" style={styles.cancelButton} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" style={styles.confirmButton} onClick={onConfirm}>
            Queue unsent only
          </button>
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    padding: '24px',
  },
  modal: {
    position: 'relative',
    width: '100%',
    maxWidth: '520px',
    backgroundColor: '#fff',
    borderRadius: '12px',
    padding: '24px',
    boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
  },
  close: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: '#6b7280',
  },
  iconRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '12px',
  },
  title: { margin: 0, fontSize: '20px', fontWeight: 700, color: '#111827' },
  body: { fontSize: '14px', color: '#374151', lineHeight: 1.5, margin: '0 0 12px' },
  list: { margin: '0 0 12px 20px', padding: 0, fontSize: '14px', color: '#374151', lineHeight: 1.6 },
  warning: {
    fontSize: '13px',
    color: '#92400e',
    backgroundColor: '#fffbeb',
    border: '1px solid #fcd34d',
    borderRadius: '8px',
    padding: '12px',
    margin: '0 0 20px',
    lineHeight: 1.5,
  },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: '10px' },
  cancelButton: {
    padding: '10px 16px',
    borderRadius: '8px',
    border: '1px solid #d1d5db',
    backgroundColor: '#fff',
    cursor: 'pointer',
    fontWeight: 600,
  },
  confirmButton: {
    padding: '10px 16px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#b45309',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 700,
  },
};

export default GradualSendWarningModal;
