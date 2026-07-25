// Step 82: Create WaiverSignScreen.jsx
// Public waiver signing flow
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { FiFileText, FiCheckCircle, FiAlertCircle } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import WaiverSignatureService from '../../services/Waivers/WaiverSignatureService';
import WaiverSignatureCapture from '../../components/Waivers/WaiverSignatureCapture';
import WaiverConsentCheckboxes from '../../components/Waivers/WaiverConsentCheckboxes';
import { renderWaiverField, validateWaiverForm } from '../../utils/waiverFormBuilder.jsx';
import { saveSignatureImage } from '../../utils/waiverSignatureCapture';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';
import { buildWaiverConsentInsertRows } from '../../constants/waiverConsentTypes';
import WaiverMailIntegration from '../../services/Waivers/WaiverMailIntegration';
import { waiverTemplateBodyInnerHtml } from '../../services/Waivers/waiverRecordDocumentHtml';
import { useWaiverTabletKeyboardInset } from '../../hooks/useWaiverTabletKeyboardInset';

const WaiverSignScreen = () => {
  useWaiverTabletKeyboardInset(true);

  const { signatureToken } = useParams();
  const [waiver, setWaiver] = useState(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [submitComplete, setSubmitComplete] = useState(false);
  const [formData, setFormData] = useState({});
  const [signatureData, setSignatureData] = useState(null);
  const [consentData, setConsentData] = useState({});
  const [authorized, setAuthorized] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    loadWaiver();
  }, [signatureToken]);

  const loadWaiver = async () => {
    try {
      setLoading(true);
      const data = await WaiverSignatureService.getWaiverByToken(signatureToken);
      if (!data) {
        toast.error('Waiver not found or link expired');
        return;
      }
      setWaiver(data);
      
      // Pre-fill form data
      setFormData({
        firstName: data.first_name || '',
        lastName: data.last_name || '',
        email: data.email || '',
        phoneNumber: data.phone_number || '',
        dateOfBirth: data.date_of_birth || '',
        address: data.address || '',
        postalCode: data.postal_code || ''
      });
    } catch (error) {
      console.error('Error loading waiver:', error);
      toast.error('Error loading waiver');
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = (fieldKey, value) => {
    setFormData(prev => ({ ...prev, [fieldKey]: value }));
  };

  const handleSignatureCaptured = (signature) => {
    setSignatureData(signature);
  };

  const handleConsentChange = (consents) => {
    setConsentData(consents);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const validation = validateWaiverForm(waiver?.waiver_templates?.fields_config?.fields || [], formData);
    setErrors(validation.errors || {});
    if (!validation.isValid) {
      toast.error('Please complete the required fields');
      return;
    }
    
    if (!authorized && waiver?.waiver_templates?.requires_digital_signature) {
      toast.error('Please acknowledge the digital signature authorization');
      return;
    }

    if (!signatureData) {
      toast.error('Please provide your signature');
      return;
    }

    setSigning(true);

    try {
      // Save signature image to storage
      let signatureUrl;
      try {
        signatureUrl = await saveSignatureImage(
          signatureData,
          waiver.business_id,
          waiver.id
        );
      } catch (error) {
        console.error('Error saving signature:', error);
        // Fallback: use data URL directly
        signatureUrl = { publicUrl: signatureData.imageUrl };
      }

      // Calculate expiry date - check settings first, then template
      // CRITICAL: Expiry must be calculated from signed_at, not Date.now()
      let expiryDays = null;

      // Check global waiver settings for default_expiry_days
      const { data: globalSettings } = await supabase
        .from('waiver_settings')
        .select('setting_value, setting_key, is_global')
        .eq('business_id', waiver.business_id)
        .eq('setting_key', 'default_expiry_days')
        .eq('is_global', true)
        .maybeSingle();

      if (globalSettings?.setting_value !== null && globalSettings?.setting_value !== undefined) {
        expiryDays = typeof globalSettings.setting_value === 'number' 
          ? globalSettings.setting_value 
          : parseInt(globalSettings.setting_value);
      }
      
      // If no global setting, check template
      if (!expiryDays || isNaN(expiryDays)) {
        expiryDays = waiver.waiver_templates?.expiry_days;
      }

      // CRITICAL FIX: Calculate expiry from signed_at time
      // Use a single timestamp for both signed_at and expiry calculation to ensure consistency
      const signedAtTimestamp = new Date();
      const signedAt = signedAtTimestamp.toISOString();

      let expiresAt = null;
      if (expiryDays && !isNaN(expiryDays) && expiryDays > 0) {
        // Calculate expiry: signed_at + expiryDays
        const expiryDate = new Date(signedAtTimestamp.getTime() + expiryDays * 24 * 60 * 60 * 1000);
        expiresAt = expiryDate.toISOString();
      }

      // Sign the waiver
      await WaiverSignatureService.signWaiver(waiver.id, {
        customerId: waiver.customer_id || null,
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        phoneNumber: formData.phoneNumber,
        dateOfBirth: formData.dateOfBirth || null,
        address: formData.address || null,
        postalCode: formData.postalCode || null,
        signatureImageUrl: signatureUrl.publicUrl,
        signatureData: signatureData,
        ipAddress: null, // Would get from request
        userAgent: navigator.userAgent,
        marketingOptIn:
          typeof consentData.marketing === 'boolean' ? consentData.marketing : undefined,
        expiresAt: expiresAt
      });

      const effectiveConsentData = { ...consentData };
      const hasMarketingConsent = Array.isArray(template?.fields_config?.consents)
        && template.fields_config.consents.some((consent) => consent?.consent_type === 'marketing');
      if (hasMarketingConsent && typeof effectiveConsentData.marketing !== 'boolean') {
        effectiveConsentData.marketing = true;
      }

      const consentRows = buildWaiverConsentInsertRows(waiver.id, effectiveConsentData, {
        additionalAdultIntentAcknowledgments: [],
        acknowledgedAt: signedAt
      });
      if (consentRows.length > 0) {
        const { error: consentErr } = await supabase.from('waiver_consents').insert(consentRows);
        if (consentErr) {
          console.error('[WaiverSignScreen] waiver_consents insert failed:', consentErr);
        } else {
          try {
            WaiverMailIntegration.setBusinessId(waiver.business_id);
            await WaiverMailIntegration.syncWaiverToMail(waiver.id, formData.email || waiver.email || null);
          } catch (syncError) {
            console.error('[WaiverSignScreen] Waiver mail sync failed:', syncError);
          }
        }
      }

      toast.success('Waiver signed successfully!');
      setSubmitComplete(true);
    } catch (error) {
      console.error('Error signing waiver:', error);
      toast.error('Error signing waiver');
    } finally {
      setSigning(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>
          <p>Loading waiver...</p>
        </div>
      </div>
    );
  }

  if (!waiver) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>
          <FiAlertCircle size={48} style={{ color: TavariStyles.colors.error }} />
          <h2>Waiver Not Found</h2>
          <p>The waiver link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  const template = waiver.waiver_templates;

  if (submitComplete) {
    return (
      <div style={styles.container}>
        <div style={styles.content}>
          <div style={styles.successState}>
            <FiCheckCircle size={56} style={styles.successIcon} />
            <h1 style={styles.title}>Waiver Signed</h1>
            <p style={styles.successText}>
              Your waiver has been signed successfully. You can close this page.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <div style={styles.header}>
          <FiFileText size={32} style={styles.headerIcon} />
          <h1 style={styles.title}>{template?.waiver_title || 'Waiver'}</h1>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          {/* Waiver Content */}
          <div style={styles.waiverContent}>
            <div dangerouslySetInnerHTML={{ __html: waiverTemplateBodyInnerHtml(template?.waiver_content || '') }} />
          </div>

          {/* Form Fields */}
          {template?.fields_config && (
            <div style={styles.fieldsSection}>
              <h3 style={styles.sectionTitle}>Adult Information</h3>
              {template.fields_config.fields?.map(field => 
                renderWaiverField(field, formData[field.field_key], handleFieldChange, errors)
              )}
            </div>
          )}

          {/* Signature Capture */}
          <div style={styles.signatureSection}>
            <h3 style={styles.sectionTitle}>Signature</h3>
            <WaiverSignatureCapture
              onSignatureCaptured={handleSignatureCaptured}
              onClear={() => setSignatureData(null)}
              required={template?.requires_digital_signature !== false}
            />
            {template?.requires_digital_signature && (
              <label style={styles.authorizationLabel}>
                <input
                  type="checkbox"
                  checked={authorized}
                  onChange={(e) => setAuthorized(e.target.checked)}
                  required
                />
                <span>I acknowledge that this is my digital signature and has the same legal effect as a handwritten signature</span>
              </label>
            )}
          </div>

          {/* Guardian Signature (if minor) */}
          {waiver.is_minor && template?.requires_guardian_signature && (
            <div style={styles.guardianSection}>
              <h3 style={styles.sectionTitle}>Guardian Signature</h3>
              <WaiverSignatureCapture
                onSignatureCaptured={() => {
                  // Handle guardian signature
                }}
                required
                label="Guardian Signature"
              />
            </div>
          )}

          {/* Consents */}
          {template?.fields_config?.consents && (
            <WaiverConsentCheckboxes
              consents={template.fields_config.consents}
              onConsentChange={handleConsentChange}
              autoClickMarketing={true}
            />
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={signing || !signatureData || (template?.requires_digital_signature && !authorized)}
            style={{
              ...styles.submitButton,
              ...((signing || !signatureData || (template?.requires_digital_signature && !authorized)) && styles.submitButtonDisabled)
            }}
          >
            {signing ? 'Signing...' : 'Sign Waiver'}
          </button>
        </form>
      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: TavariStyles.colors.background,
    padding: TavariStyles.spacing.xl
  },
  content: {
    maxWidth: '800px',
    margin: '0 auto',
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: TavariStyles.spacing.xl,
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    boxShadow: TavariStyles.shadows.lg
  },
  header: {
    textAlign: 'center',
    marginBottom: TavariStyles.spacing.xl
  },
  headerIcon: {
    color: TavariStyles.colors.primary,
    marginBottom: TavariStyles.spacing.md
  },
  title: {
    fontSize: TavariStyles.typography.fontSize['2xl'],
    fontWeight: 'bold',
    color: TavariStyles.colors.text
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.xl
  },
  waiverContent: {
    padding: TavariStyles.spacing.lg,
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: TavariStyles.borderRadius.md,
    maxHeight: '400px',
    overflowY: 'auto',
    whiteSpace: 'break-spaces',
    wordBreak: 'break-word'
  },
  fieldsSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.md
  },
  sectionTitle: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: '600',
    color: TavariStyles.colors.text,
    marginBottom: TavariStyles.spacing.md
  },
  signatureSection: {
    padding: TavariStyles.spacing.md,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md
  },
  authorizationLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: TavariStyles.spacing.sm,
    marginTop: TavariStyles.spacing.md,
    fontSize: TavariStyles.typography.fontSize.sm,
    cursor: 'pointer'
  },
  guardianSection: {
    padding: TavariStyles.spacing.md,
    border: `1px solid ${TavariStyles.colors.warning}`,
    borderRadius: TavariStyles.borderRadius.md,
    backgroundColor: '#FEF3C7'
  },
  submitButton: {
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: '600',
    cursor: 'pointer',
    marginTop: TavariStyles.spacing.lg
  },
  submitButtonDisabled: {
    backgroundColor: TavariStyles.colors.gray300,
    cursor: 'not-allowed',
    opacity: 0.6
  },
  loading: {
    textAlign: 'center',
    padding: TavariStyles.spacing.xl
  },
  error: {
    textAlign: 'center',
    padding: TavariStyles.spacing.xl
  },
  successState: {
    textAlign: 'center',
    padding: `${TavariStyles.spacing.xl} 0`
  },
  successIcon: {
    color: TavariStyles.colors.success,
    marginBottom: TavariStyles.spacing.md
  },
  successText: {
    color: TavariStyles.colors.textSecondary || TavariStyles.colors.gray600,
    fontSize: TavariStyles.typography.fontSize.lg
  }
};

export default WaiverSignScreen;

