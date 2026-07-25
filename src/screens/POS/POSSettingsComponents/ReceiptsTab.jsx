// src/screens/POS/POSSettingsComponents/ReceiptsTab.jsx
import React from 'react';
import TavariCheckbox from '../../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';

const ReceiptsTab = ({ settings, handleInputChange }) => {
  return (
    <div style={styles.tabContent}>
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Receipt Settings</h3>
        
        {/* Step 127: Receipt automation toggle */}
        <div style={styles.setting}>
          <TavariCheckbox
            checked={!!settings.receipt_auto_print}
            onChange={(checked) => handleInputChange('receipt_auto_print', checked)}
            label="Enable automatic receipt printing"
            id="receipt-auto-print"
            testId="receipt-auto-print-checkbox"
          />
          <div style={styles.settingDescription}>
            When enabled, receipts will automatically print after each transaction without prompting.
            When off, staff can still print manually from the receipt screen.
          </div>
        </div>

        {/* Step 127: Require receipt confirmation toggle */}
        <div style={styles.setting}>
          <TavariCheckbox
            checked={!!settings.require_receipt_confirmation}
            onChange={(checked) => handleInputChange('require_receipt_confirmation', checked)}
            label="Require receipt confirmation"
            id="require-receipt-confirmation"
            testId="require-receipt-confirmation-checkbox"
          />
          <div style={styles.settingDescription}>
            When enabled, staff must confirm whether the customer wants a receipt after each transaction.
          </div>
        </div>

        <div style={styles.setting}>
          <label style={styles.label}>Receipt Footer Message:</label>
          <textarea
            value={settings.receipt_footer || ''}
            onChange={(e) => handleInputChange('receipt_footer', e.target.value)}
            placeholder="Thank you for your business!"
            style={styles.textarea}
            rows="3"
          />
          <div style={styles.settingDescription}>
            Custom message printed at the bottom of all receipts.
          </div>
        </div>

        {/* Receipt behavior preview */}
        <div style={styles.receiptPreview}>
          <h4 style={styles.subSectionTitle}>Receipt Behavior Preview</h4>
          <div style={styles.previewContent}>
            {settings.receipt_auto_print && !settings.require_receipt_confirmation && (
              <div style={styles.previewItem}>
                <span style={styles.previewIcon}>🖨️</span>
                <span>Receipt automatically prints after every sale - No confirmation needed</span>
              </div>
            )}
            {!settings.receipt_auto_print && settings.require_receipt_confirmation && (
              <div style={styles.previewItem}>
                <span style={styles.previewIcon}>❓</span>
                <span>Staff must ask customer if they want a receipt - Manual printing</span>
              </div>
            )}
            {settings.receipt_auto_print && settings.require_receipt_confirmation && (
              <div style={styles.previewItem}>
                <span style={styles.previewIcon}>✅</span>
                <span>Staff confirms receipt preference - Then prints automatically if yes</span>
              </div>
            )}
            {!settings.receipt_auto_print && !settings.require_receipt_confirmation && (
              <div style={styles.previewItem}>
                <span style={styles.previewIcon}>📄</span>
                <span>Receipt options shown - Staff or customer chooses</span>
              </div>
            )}
          </div>
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
  textarea: {
    width: '100%',
    padding: TavariStyles.spacing.md,
    border: `2px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: TavariStyles.typography.fontSize.base,
    fontFamily: TavariStyles.typography.fontFamily,
    resize: 'vertical',
    minHeight: '60px'
  },
  settingDescription: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray600,
    marginTop: TavariStyles.spacing.xs,
    fontStyle: 'italic'
  },
  receiptPreview: {
    marginTop: TavariStyles.spacing.xl,
    padding: TavariStyles.spacing.lg,
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.md,
    border: `1px solid ${TavariStyles.colors.gray200}`
  },
  subSectionTitle: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800,
    marginBottom: TavariStyles.spacing.md
  },
  previewContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.sm
  },
  previewItem: {
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.md,
    padding: TavariStyles.spacing.sm,
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: TavariStyles.borderRadius.sm,
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray700
  },
  previewIcon: {
    fontSize: TavariStyles.typography.fontSize.xl
  }
};

export default ReceiptsTab;