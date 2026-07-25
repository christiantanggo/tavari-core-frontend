import React from 'react';
import { FiAlertCircle, FiMail, FiPhone } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    zIndex: 400,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    maxWidth: 480,
    width: '100%',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.15)',
    overflow: 'hidden',
  },
  header: {
    padding: '20px 24px',
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: '#fef2f2',
    color: '#dc2626',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
    color: TavariStyles.colors.gray900,
    lineHeight: 1.3,
  },
  body: {
    padding: '20px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  message: {
    margin: 0,
    fontSize: 15,
    lineHeight: 1.55,
    color: TavariStyles.colors.gray800,
    whiteSpace: 'pre-wrap',
  },
  guidance: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.55,
    color: TavariStyles.colors.gray600,
  },
  contactBox: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: TavariStyles.colors.gray50,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  contactLabel: {
    fontSize: 13,
    fontWeight: 700,
    color: TavariStyles.colors.gray700,
  },
  contactRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: 14,
    color: TavariStyles.colors.gray800,
    textDecoration: 'none',
  },
  contactIcon: {
    color: TavariStyles.colors.primary,
    flexShrink: 0,
  },
  footer: {
    padding: '16px 24px 20px',
    borderTop: `1px solid ${TavariStyles.colors.gray200}`,
    display: 'flex',
    justifyContent: 'flex-end',
  },
  button: {
    border: 'none',
    borderRadius: 8,
    padding: '12px 20px',
    fontSize: 14,
    fontWeight: 600,
    backgroundColor: TavariStyles.colors.primary,
    color: '#fff',
    cursor: 'pointer',
  },
};

/**
 * Customer-facing error dialog for the booking portal.
 * Shows the error, suggests trying again, and lists facility phone/email from location settings.
 */
export default function PortalCustomerErrorModal({
  open,
  title = 'Something went wrong',
  message,
  businessName,
  phone,
  email,
  onClose,
}) {
  if (!open) return null;

  const trimmedPhone = typeof phone === 'string' ? phone.trim() : '';
  const trimmedEmail = typeof email === 'string' ? email.trim() : '';
  const hasContact = Boolean(trimmedPhone || trimmedEmail);
  const placeLabel = businessName?.trim() || 'the facility';

  return (
    <div
      style={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="portal-customer-error-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div style={styles.card}>
        <div style={styles.header}>
          <div style={styles.iconWrap} aria-hidden="true">
            <FiAlertCircle size={22} />
          </div>
          <h2 id="portal-customer-error-title" style={styles.title}>
            {title}
          </h2>
        </div>

        <div style={styles.body}>
          <p style={styles.message}>
            {message || 'We could not complete that step.'}
          </p>
          <p style={styles.guidance}>
            Please try again. If the problem continues, contact {placeLabel} using the details below
            and they can help finish your booking.
          </p>

          {hasContact ? (
            <div style={styles.contactBox}>
              <div style={styles.contactLabel}>Contact {placeLabel}</div>
              {trimmedPhone ? (
                <a href={`tel:${trimmedPhone.replace(/[^\d+]/g, '')}`} style={styles.contactRow}>
                  <FiPhone size={16} style={styles.contactIcon} aria-hidden="true" />
                  <span>{trimmedPhone}</span>
                </a>
              ) : null}
              {trimmedEmail ? (
                <a href={`mailto:${trimmedEmail}`} style={styles.contactRow}>
                  <FiMail size={16} style={styles.contactIcon} aria-hidden="true" />
                  <span>{trimmedEmail}</span>
                </a>
              ) : null}
            </div>
          ) : (
            <p style={styles.guidance}>
              Contact details for this location are not listed yet. Please try again in a moment, or
              reach out through the facility&apos;s website if you still need help.
            </p>
          )}
        </div>

        <div style={styles.footer}>
          <button type="button" style={styles.button} onClick={onClose}>
            OK, try again
          </button>
        </div>
      </div>
    </div>
  );
}
