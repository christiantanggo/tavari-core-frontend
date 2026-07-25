// Music Subscription Gate Component
// Shows upgrade prompt if user doesn't have access to Music module
import React from 'react';
import { FiLock, FiArrowRight, FiMusic } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import { useNavigate } from 'react-router-dom';

const MusicSubscriptionGate = ({ tier, status, isTrial, trialDaysRemaining }) => {
  const navigate = useNavigate();

  const handleUpgrade = () => {
    // Navigate to subscription/upgrade page (to be created)
    // For now, just show a message
    alert('Upgrade functionality coming soon! Contact support to upgrade your Music module subscription.');
  };

  if (isTrial && trialDaysRemaining !== null) {
    return (
      <div style={styles.container}>
        <div style={styles.content}>
          <div style={styles.iconContainer}>
            <FiMusic size={48} style={{ color: TavariStyles.colors.warning }} />
          </div>
          <h2 style={styles.title}>Trial Period Active</h2>
          <p style={styles.message}>
            You're currently on a trial of the Music module. 
            {trialDaysRemaining > 0 ? (
              <strong> {trialDaysRemaining} day{trialDaysRemaining !== 1 ? 's' : ''} remaining.</strong>
            ) : (
              <strong> Your trial has ended.</strong>
            )}
          </p>
          <p style={styles.subMessage}>
            Upgrade to continue using all Music features after your trial ends.
          </p>
          <button style={styles.upgradeButton} onClick={handleUpgrade}>
            Upgrade Now <FiArrowRight style={{ marginLeft: 8 }} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <div style={styles.iconContainer}>
          <FiLock size={48} style={{ color: TavariStyles.colors.danger }} />
        </div>
        <h2 style={styles.title}>Music Module Not Available</h2>
        <p style={styles.message}>
          You don't have an active subscription to the Music module.
        </p>
        <p style={styles.subMessage}>
          Subscribe to access music playlists, scheduling, ad management, and more.
        </p>
        <div style={styles.featuresList}>
          <div style={styles.featureItem}>
            <span style={styles.checkmark}>✓</span>
            <span>Unlimited music library</span>
          </div>
          <div style={styles.featureItem}>
            <span style={styles.checkmark}>✓</span>
            <span>Playlist management</span>
          </div>
          <div style={styles.featureItem}>
            <span style={styles.checkmark}>✓</span>
            <span>Schedule playlists</span>
          </div>
          <div style={styles.featureItem}>
            <span style={styles.checkmark}>✓</span>
            <span>Ad revenue sharing</span>
          </div>
          <div style={styles.featureItem}>
            <span style={styles.checkmark}>✓</span>
            <span>Desktop app support</span>
          </div>
        </div>
        <button style={styles.upgradeButton} onClick={handleUpgrade}>
          Subscribe to Music Module <FiArrowRight style={{ marginLeft: 8 }} />
        </button>
        <button 
          style={styles.backButton} 
          onClick={() => navigate('/dashboard/home')}
        >
          Back to Dashboard
        </button>
      </div>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '60vh',
    padding: TavariStyles.spacing.xl,
    backgroundColor: TavariStyles.colors.background,
  },
  content: {
    maxWidth: 600,
    textAlign: 'center',
    backgroundColor: '#fff',
    padding: TavariStyles.spacing.xxl,
    borderRadius: TavariStyles.borderRadius.lg,
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
  },
  iconContainer: {
    marginBottom: TavariStyles.spacing.lg,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    color: TavariStyles.colors.gray900,
    margin: 0,
    marginBottom: TavariStyles.spacing.md,
  },
  message: {
    fontSize: 16,
    color: TavariStyles.colors.gray700,
    margin: 0,
    marginBottom: TavariStyles.spacing.sm,
    lineHeight: 1.6,
  },
  subMessage: {
    fontSize: 14,
    color: TavariStyles.colors.gray600,
    margin: 0,
    marginBottom: TavariStyles.spacing.lg,
  },
  featuresList: {
    textAlign: 'left',
    margin: `${TavariStyles.spacing.lg} 0`,
    padding: TavariStyles.spacing.lg,
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: TavariStyles.borderRadius.md,
  },
  featureItem: {
    display: 'flex',
    alignItems: 'center',
    padding: `${TavariStyles.spacing.sm} 0`,
    fontSize: 14,
    color: TavariStyles.colors.gray700,
  },
  checkmark: {
    color: TavariStyles.colors.success,
    fontWeight: 700,
    marginRight: TavariStyles.spacing.sm,
    fontSize: 18,
  },
  upgradeButton: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
    backgroundColor: TavariStyles.colors.primary,
    color: '#fff',
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: TavariStyles.spacing.md,
    transition: 'all 0.2s',
  },
  backButton: {
    display: 'block',
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.lg}`,
    backgroundColor: 'transparent',
    color: TavariStyles.colors.gray700,
    border: `1px solid ${TavariStyles.colors.border}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    margin: `${TavariStyles.spacing.md} auto 0`,
    transition: 'all 0.2s',
  },
};

export default MusicSubscriptionGate;



