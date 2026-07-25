// Step 97: Create WaiverConsentCheckboxes.jsx
// Consent checkboxes during waiver signing
import React, { useState, useEffect } from 'react';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';

const WaiverConsentCheckboxes = ({ 
  consents = [], 
  onConsentChange, 
  autoClickMarketing = true,
  consentStates = {},
  requiredConsents = []
}) => {
  const [localConsentStates, setLocalConsentStates] = useState({});

  useEffect(() => {
    // Initialize consent states
    const initialStates = {};
    consents.forEach(consent => {
      const providedValue = consentStates?.[consent.consent_type];
      initialStates[consent.consent_type] =
        typeof providedValue === 'boolean'
          ? providedValue
          : autoClickMarketing && consent.consent_type === 'marketing';
    });
    setLocalConsentStates(initialStates);
  }, [consents, autoClickMarketing, consentStates]);

  useEffect(() => {
    // Notify parent of consent changes
    if (onConsentChange) {
      onConsentChange(localConsentStates);
    }
  }, [localConsentStates, onConsentChange]);

  const handleConsentChange = (consentType, value) => {
    setLocalConsentStates(prev => ({
      ...prev,
      [consentType]: value
    }));
  };

  const getConsentLabel = (consentType) => {
    switch (consentType) {
      case 'marketing':
        return 'I consent to receive marketing communications';
      case 'medical':
        return 'I consent to medical treatment if needed';
      case 'other':
        return 'I consent to other uses as specified';
      default:
        return `I consent to ${consentType}`;
    }
  };

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>Consents</h3>
      {consents.length > 0 ? (
        <div style={styles.consentList}>
          {consents.map((consent) => {
            const isRequired = requiredConsents.includes(consent.consent_type);
            const isChecked = localConsentStates[consent.consent_type] || false;

            return (
              <div key={consent.consent_type} style={styles.consentItem}>
                <div style={styles.checkboxWrapper}>
                  <TavariCheckbox
                    checked={isChecked}
                    onChange={(checked) => handleConsentChange(consent.consent_type, checked)}
                    label={getConsentLabel(consent.consent_type) + (isRequired ? '*' : '')}
                    size="md"
                  />
                  {consent.description && (
                    <p style={styles.consentDescription}>{consent.description}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p style={styles.emptyState}>No consents required for this waiver</p>
      )}
    </div>
  );
};

const styles = {
  container: {
    marginBottom: TavariStyles.spacing.lg,
    padding: TavariStyles.spacing.md,
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: TavariStyles.borderRadius.md
  },
  title: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    marginBottom: TavariStyles.spacing.md
  },
  consentList: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.md
  },
  consentItem: {
    backgroundColor: TavariStyles.colors.white,
    padding: TavariStyles.spacing.md,
    borderRadius: TavariStyles.borderRadius.sm,
    border: `1px solid ${TavariStyles.colors.gray300}`
  },
  checkboxWrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.xs
  },
  required: {
    color: TavariStyles.colors.error,
    marginLeft: '4px'
  },
  consentDescription: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    margin: 0,
    lineHeight: 1.5
  },
  emptyState: {
    textAlign: 'center',
    color: TavariStyles.colors.gray600,
    padding: TavariStyles.spacing.md,
    fontStyle: 'italic'
  }
};

export default WaiverConsentCheckboxes;




