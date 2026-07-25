// Step 94: Create WaiverStatusBadge.jsx
// Status badge component for waivers
import React from 'react';
import { FiCheckCircle, FiAlertCircle, FiClock } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import { getWaiverStatus, isWaiverExpired } from '../../utils/waiverUtils';

const WaiverStatusBadge = ({ waiver, showExpiryDate = true }) => {
  const status = getWaiverStatus(waiver);
  const expired = isWaiverExpired(waiver.expires_at);

  const getStatusConfig = () => {
    switch (status) {
      case 'valid':
        if (waiver.expires_at) {
          const expiryDate = new Date(waiver.expires_at);
          const daysUntilExpiry = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
          
          if (daysUntilExpiry <= 30 && daysUntilExpiry > 0) {
            return {
              label: 'Expiring Soon',
              color: TavariStyles.colors.warning,
              icon: <FiClock />,
              bgColor: '#FEF3C7'
            };
          }
        }
        return {
          label: 'Valid',
          color: TavariStyles.colors.success,
          icon: <FiCheckCircle />,
          bgColor: '#D1FAE5'
        };
      case 'expired':
        return {
          label: 'Expired',
          color: TavariStyles.colors.error,
          icon: <FiAlertCircle />,
          bgColor: '#FEE2E2'
        };
      case 'invalid':
        return {
          label: 'Invalid',
          color: TavariStyles.colors.error,
          icon: <FiAlertCircle />,
          bgColor: '#FEE2E2'
        };
      case 'pending':
        return {
          label: 'Pending',
          color: TavariStyles.colors.warning,
          icon: <FiClock />,
          bgColor: '#FEF3C7'
        };
      default:
        return {
          label: 'Unknown',
          color: TavariStyles.colors.gray600,
          icon: <FiAlertCircle />,
          bgColor: TavariStyles.colors.gray200
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div style={{
      ...styles.badge,
      backgroundColor: config.bgColor,
      color: config.color
    }}>
      <span style={styles.icon}>{config.icon}</span>
      <span style={styles.label}>{config.label}</span>
      {showExpiryDate && waiver.expires_at && (
        <span style={styles.expiryDate}>
          {expired ? 'Expired' : `Expires ${new Date(waiver.expires_at).toLocaleDateString()}`}
        </span>
      )}
    </div>
  );
};

const styles = {
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.xs,
    padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
    borderRadius: TavariStyles.borderRadius.full,
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: '600',
    whiteSpace: 'nowrap'
  },
  icon: {
    display: 'flex',
    alignItems: 'center'
  },
  label: {
    fontWeight: '600'
  },
  expiryDate: {
    fontSize: TavariStyles.typography.fontSize.xs,
    opacity: 0.8,
    marginLeft: TavariStyles.spacing.xs
  }
};

export default WaiverStatusBadge;




