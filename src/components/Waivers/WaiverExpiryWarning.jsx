// Step 96: Create WaiverExpiryWarning.jsx
// Show expiry warnings for waivers
import React from 'react';
import { FiAlertCircle, FiClock, FiCheckCircle } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import { isWaiverExpired } from '../../utils/waiverUtils';

const WaiverExpiryWarning = ({ waiver, daysWarningThreshold = 30, onSendReminder, onSignNew }) => {
  if (!waiver || !waiver.expires_at) {
    return null;
  }

  const expired = isWaiverExpired(waiver.expires_at);
  const expiryDate = new Date(waiver.expires_at);
  const daysUntilExpiry = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));

  if (expired) {
    return (
      <div style={{ ...styles.warning, ...styles.expired }}>
        <FiAlertCircle style={styles.icon} />
        <div style={styles.content}>
          <h4 style={styles.title}>Waiver Expired</h4>
          <p style={styles.message}>
            This waiver expired on {expiryDate.toLocaleDateString()}. A new waiver must be signed.
          </p>
          {onSignNew && (
            <button
              type="button"
              onClick={onSignNew}
              style={styles.actionButton}
            >
              Sign New Waiver
            </button>
          )}
        </div>
      </div>
    );
  }

  if (daysUntilExpiry <= daysWarningThreshold && daysUntilExpiry > 0) {
    return (
      <div style={{ ...styles.warning, ...styles.expiringSoon }}>
        <FiClock style={styles.icon} />
        <div style={styles.content}>
          <h4 style={styles.title}>Waiver Expiring Soon</h4>
          <p style={styles.message}>
            This waiver expires in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? 's' : ''} on {expiryDate.toLocaleDateString()}.
          </p>
          <div style={styles.actions}>
            {onSendReminder && (
              <button
                type="button"
                onClick={onSendReminder}
                style={styles.actionButton}
              >
                Send Reminder
              </button>
            )}
            {onSignNew && (
              <button
                type="button"
                onClick={onSignNew}
                style={{ ...styles.actionButton, ...styles.secondaryButton }}
              >
                Sign New Waiver
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...styles.warning, ...styles.valid }}>
      <FiCheckCircle style={styles.icon} />
      <div style={styles.content}>
        <h4 style={styles.title}>Waiver Valid</h4>
        <p style={styles.message}>
          This waiver is valid until {expiryDate.toLocaleDateString()}.
        </p>
      </div>
    </div>
  );
};

const styles = {
  warning: {
    display: 'flex',
    gap: TavariStyles.spacing.md,
    padding: TavariStyles.spacing.md,
    borderRadius: TavariStyles.borderRadius.md,
    marginBottom: TavariStyles.spacing.md
  },
  expired: {
    backgroundColor: '#FEE2E2',
    border: `1px solid ${TavariStyles.colors.error}`
  },
  expiringSoon: {
    backgroundColor: '#FEF3C7',
    border: `1px solid ${TavariStyles.colors.warning}`
  },
  valid: {
    backgroundColor: '#D1FAE5',
    border: `1px solid ${TavariStyles.colors.success}`
  },
  icon: {
    fontSize: '24px',
    flexShrink: 0,
    marginTop: '2px'
  },
  content: {
    flex: 1
  },
  title: {
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: '600',
    color: TavariStyles.colors.text,
    margin: 0,
    marginBottom: TavariStyles.spacing.xs
  },
  message: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.text,
    margin: 0,
    marginBottom: TavariStyles.spacing.sm
  },
  actions: {
    display: 'flex',
    gap: TavariStyles.spacing.sm,
    flexWrap: 'wrap'
  },
  actionButton: {
    padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.md}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.sm,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: '500'
  },
  secondaryButton: {
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.primary,
    border: `1px solid ${TavariStyles.colors.primary}`
  }
};

export default WaiverExpiryWarning;




