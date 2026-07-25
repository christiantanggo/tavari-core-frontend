// src/screens/POS/POSSettingsComponents/LoyaltyTab.jsx
import React from 'react';
import { Link } from 'react-router-dom';
import { TavariStyles } from '../../../utils/TavariStyles';

const LoyaltyTab = ({ settings, handleInputChange }) => {
  return (
    <div style={styles.tabContent}>
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Loyalty Program Settings</h3>
        <div style={styles.settingDescription}>
          Configure how your loyalty program operates and tracks customer rewards.
        </div>
        
        {/* Loyalty mode selection */}
        <div style={styles.setting}>
          <label style={styles.label}>Loyalty Program Mode:</label>
          <div style={styles.loyaltyModeToggle}>
            <button
              style={{
                ...styles.toggleButton,
                ...(settings.loyalty_mode === 'points' ? styles.activeToggleButton : {})
              }}
              onClick={() => handleInputChange('loyalty_mode', 'points')}
            >
              <span style={styles.toggleIcon}>🏆</span>
              Points Based
            </button>
            <button
              style={{
                ...styles.toggleButton,
                ...(settings.loyalty_mode === 'dollars' ? styles.activeToggleButton : {})
              }}
              onClick={() => handleInputChange('loyalty_mode', 'dollars')}
            >
              <span style={styles.toggleIcon}>💵</span>
              Dollar Based
            </button>
          </div>
          <div style={styles.settingDescription}>
            {settings.loyalty_mode === 'points' 
              ? 'Customers earn points for purchases that can be redeemed for rewards.'
              : 'Customers earn dollar credits that can be applied directly to future purchases.'}
          </div>
        </div>

        {/* Account credit expiration */}
        <div style={styles.setting}>
          <label style={styles.label}>Account Credit Expiration:</label>
          <div style={styles.inputGroup}>
            <input
              type="number"
              min="0"
              max="9999"
              value={settings.account_credit_expiration_days || 365}
              onChange={(e) => handleInputChange('account_credit_expiration_days', parseInt(e.target.value) || 365)}
              style={styles.input}
            />
            <span style={styles.inputSuffix}>days</span>
          </div>
          <div style={styles.settingDescription}>
            Number of days before loyalty points or credits expire. Set to 0 for no expiration.
            {settings.account_credit_expiration_days === 0 && (
              <span style={styles.warningText}> Warning: No expiration may lead to liability accumulation.</span>
            )}
          </div>
        </div>

        {/* Loyalty program preview */}
        <div style={styles.loyaltyPreview}>
          <h4 style={styles.subSectionTitle}>Loyalty Program Configuration</h4>
          <div style={styles.loyaltyGrid}>
            <div style={styles.loyaltyCard}>
              <div style={styles.loyaltyCardIcon}>
                {settings.loyalty_mode === 'points' ? '🏆' : '💵'}
              </div>
              <div style={styles.loyaltyCardTitle}>Program Type</div>
              <div style={styles.loyaltyCardValue}>
                {settings.loyalty_mode === 'points' ? 'Points Based' : 'Dollar Credits'}
              </div>
            </div>
            <div style={styles.loyaltyCard}>
              <div style={styles.loyaltyCardIcon}>📅</div>
              <div style={styles.loyaltyCardTitle}>Expiration Period</div>
              <div style={styles.loyaltyCardValue}>
                {settings.account_credit_expiration_days === 0 
                  ? 'Never Expires' 
                  : `${settings.account_credit_expiration_days} Days`}
              </div>
            </div>
            <div style={styles.loyaltyCard}>
              <div style={styles.loyaltyCardIcon}>⏰</div>
              <div style={styles.loyaltyCardTitle}>Annual Expiry</div>
              <div style={styles.loyaltyCardValue}>
                {settings.account_credit_expiration_days === 365 
                  ? 'Yes (1 Year)' 
                  : settings.account_credit_expiration_days === 0 
                  ? 'No Expiry' 
                  : `Every ${(settings.account_credit_expiration_days / 365).toFixed(1)} Years`}
              </div>
            </div>
          </div>
        </div>

        <div style={styles.loyaltyNote}>
          <strong>Note:</strong> Detailed loyalty program configuration including earning rates, redemption rules,
          and tier settings can be found in the dedicated Loyalty Settings screen.
        </div>

        <div style={styles.linkRow}>
          <Link to="/dashboard/pos/loyalty-settings" style={styles.settingsLink}>
            Open Loyalty Program Settings
          </Link>
          <Link to="/dashboard/pos/loyalty-settings?tab=offers" style={styles.settingsLink}>
            Configure Personalized Offers
          </Link>
        </div>
      </div>
    </div>
  );
};

const styles = {
  tabContent: {
    padding: TavariStyles.spacing['3xl']
  },
  section: {
    marginBottom: TavariStyles.spacing['3xl']
  },
  sectionTitle: {
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800,
    marginBottom: TavariStyles.spacing.xl,
    paddingBottom: TavariStyles.spacing.md,
    borderBottom: `2px solid ${TavariStyles.colors.primary}`
  },
  setting: {
    marginBottom: TavariStyles.spacing.xl
  },
  label: {
    ...TavariStyles.components.form.label
  },
  input: {
    ...TavariStyles.components.form.input,
    width: '120px'
  },
  inputGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm
  },
  inputSuffix: {
    fontSize: TavariStyles.typography.fontSize.base,
    color: TavariStyles.colors.gray600
  },
  settingDescription: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray600,
    marginTop: TavariStyles.spacing.xs,
    fontStyle: 'italic'
  },
  loyaltyModeToggle: {
    display: 'flex',
    gap: TavariStyles.spacing.md,
    marginTop: TavariStyles.spacing.md,
    marginBottom: TavariStyles.spacing.xl
  },
  toggleButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.secondary,
    minWidth: '120px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: TavariStyles.spacing.xs
  },
  activeToggleButton: {
    backgroundColor: TavariStyles.colors.secondary,
    color: TavariStyles.colors.white,
    borderColor: TavariStyles.colors.secondary
  },
  toggleIcon: {
    fontSize: TavariStyles.typography.fontSize.xl,
    marginRight: TavariStyles.spacing.xs
  },
  warningText: {
    color: TavariStyles.colors.warning,
    fontWeight: TavariStyles.typography.fontWeight.bold
  },
  loyaltyPreview: {
    marginTop: TavariStyles.spacing['2xl'],
    padding: TavariStyles.spacing.xl,
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: TavariStyles.borderRadius.lg,
    border: `2px solid ${TavariStyles.colors.loyaltyGreen}`
  },
  subSectionTitle: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800,
    marginBottom: TavariStyles.spacing.md
  },
  loyaltyGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: TavariStyles.spacing.lg,
    marginTop: TavariStyles.spacing.lg
  },
  loyaltyCard: {
    padding: TavariStyles.spacing.lg,
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.md,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    textAlign: 'center',
    boxShadow: TavariStyles.shadows.sm
  },
  loyaltyCardIcon: {
    fontSize: TavariStyles.typography.fontSize['3xl'],
    marginBottom: TavariStyles.spacing.md
  },
  loyaltyCardTitle: {
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.gray600,
    marginBottom: TavariStyles.spacing.sm
  },
  loyaltyCardValue: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.loyaltyGreen
  },
  loyaltyNote: {
    marginTop: TavariStyles.spacing.xl,
    padding: TavariStyles.spacing.md,
    backgroundColor: TavariStyles.colors.infoBg,
    borderRadius: TavariStyles.borderRadius.md,
    border: `1px solid ${TavariStyles.colors.info}`,
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray700,
    lineHeight: TavariStyles.typography.lineHeight.relaxed
  },
  linkRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: TavariStyles.spacing.md,
    marginTop: TavariStyles.spacing.lg,
  },
  settingsLink: {
    display: 'inline-block',
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.lg}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    textDecoration: 'none',
  },
};

export default LoyaltyTab;