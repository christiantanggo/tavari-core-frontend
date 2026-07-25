// WaiverTemplateWizard.jsx
// Comprehensive wizard for creating/editing waiver templates
import React, { useState, useRef, useEffect } from 'react';
import { FiX, FiArrowLeft, FiArrowRight, FiUpload, FiImage, FiCheck } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import TavariCheckbox from '../UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';

const WaiverTemplateWizard = ({ 
  isOpen, 
  onClose, 
  onSave, 
  initialData = null,
  businessId,
  isEditing = false
}) => {
  // Wizard state
  const [wizardStep, setWizardStep] = useState(0); // 0 = disclaimer, 1-7 = steps
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [businessData, setBusinessData] = useState(null);
  /** Logo URL from Settings (app_branding) — used as default and for "Use Settings logo" */
  const [brandingLogoUrl, setBrandingLogoUrl] = useState('');
  const fileInputRef = useRef(null);

  // Load business + branding logo for auto-fill (logo matches Settings → Colors & branding)
  useEffect(() => {
    if (businessId && !initialData && !isEditing) {
      loadBusinessData();
    }
  }, [businessId, initialData, isEditing]);

  const loadBusinessData = async () => {
    try {
      const [{ data, error }, brandingResult] = await Promise.all([
        supabase
          .from('businesses')
          .select('name, business_email, business_phone, business_address, business_city, business_state, business_postal, business_website')
          .eq('id', businessId)
          .single(),
        supabase
          .from('app_branding')
          .select('logo_url')
          .eq('business_id', businessId)
          .maybeSingle()
      ]);

      if (error) throw error;
      setBusinessData(data);

      if (brandingResult.error && brandingResult.error.code !== 'PGRST116') {
        console.warn('[WaiverTemplateWizard] Could not load branding logo:', brandingResult.error);
      }

      const logoFromSettings = (brandingResult.data?.logo_url || '').trim();
      setBrandingLogoUrl(logoFromSettings);

      setTemplateData(prev => ({
        ...prev,
        waiverTitle: prev.waiverTitle || (data?.name ? `${data.name} Liability Waiver` : prev.waiverTitle),
        logoUrl: prev.logoUrl || logoFromSettings
      }));
    } catch (error) {
      console.error('[WaiverTemplateWizard] Error loading business data:', error);
      // Don't show error - auto-fill is optional
    }
  };

  // Template data state
  const [templateData, setTemplateData] = useState({
    templateName: initialData?.templateName || '',
    templateKey: initialData?.templateKey || '',
    waiverTitle: initialData?.waiverTitle || '',
    logoUrl: initialData?.logoUrl || '',
    waiverContent: initialData?.waiverContent || '',
    participantFields: initialData?.participantFields || {
      firstName: false,
      lastName: false,
      phoneNumber: false,
      emailAddress: false,
      birthdate: false,
      address: false,
      postalCode: false
    },
    minorFields: initialData?.minorFields || {
      firstName: false,
      lastName: false,
      birthdate: false
    },
    signatureRequired: initialData?.signatureRequired !== false,
    notifications: initialData?.notifications || {
      emailCopy: false,
      sendLinkEmail: false,
      sendLinkSMS: false,
      reminderEmail: false,
      reminderSMS: false
    }
  });

  const handleLogoUpload = async (file) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be smaller than 5MB.');
      return;
    }

    setUploadingLogo(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${businessId}/waiver-logos/${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;

      // Use 'images' bucket (public, allows authenticated uploads)
      const { data, error } = await supabase.storage
        .from('images')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (error) throw error;

      const { data: urlData } = supabase.storage
        .from('images')
        .getPublicUrl(fileName);

      setTemplateData({ ...templateData, logoUrl: urlData.publicUrl });
      toast.success('Logo uploaded successfully');
    } catch (error) {
      console.error('Error uploading logo:', error);
      toast.error('Error uploading logo: ' + error.message);
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      handleLogoUpload(file);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const files = event.dataTransfer.files;
    if (files.length > 0) {
      handleLogoUpload(files[0]);
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const nextStep = () => {
    if (wizardStep < 7) {
      setWizardStep(wizardStep + 1);
    }
  };

  const prevStep = () => {
    if (wizardStep > 0) {
      setWizardStep(wizardStep - 1);
    }
  };

  const skipStep = () => {
    nextStep();
  };

  const handleSave = async () => {
    try {
      await onSave(templateData);
      onClose();
      // Reset wizard
      setWizardStep(0);
      setDisclaimerAccepted(false);
    } catch (error) {
      console.error('Error saving template:', error);
      throw error;
    }
  };

  if (!isOpen) return null;

  const stepNames = [
    'Disclaimer',
    'Waiver Title',
    'Logo',
    'Waiver Body',
    'Participants',
    'Minor Information',
    'Signature',
    'Notifications'
  ];

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>
            {isEditing ? 'Edit Waiver Template' : 'Create Waiver Template'}
          </h2>
          <button onClick={onClose} style={styles.closeButton}>
            <FiX size={20} />
          </button>
        </div>

        {/* Progress indicator */}
        {wizardStep > 0 && (
          <div style={styles.progress}>
            <div style={styles.progressBar}>
              <div 
                style={{ 
                  ...styles.progressFill, 
                  width: `${(wizardStep / 7) * 100}%` 
                }} 
              />
            </div>
            <p style={styles.progressText}>
              Step {wizardStep} of 7: {stepNames[wizardStep]}
            </p>
          </div>
        )}

        <div style={styles.content}>
          {/* Step 0: Disclaimer */}
          {wizardStep === 0 && (
            <div style={styles.stepContainer}>
              <h3 style={styles.stepTitle}>Important Information</h3>
              <div style={styles.disclaimerBox}>
                <p style={styles.disclaimerText}>
                  Before creating a waiver template, please ensure you understand the following:
                </p>
                <ul style={styles.disclaimerList}>
                  <li>You are responsible for ensuring your waiver content complies with all applicable laws and regulations.</li>
                  <li>Waivers should be reviewed by legal counsel before use.</li>
                  <li>The waiver title will be displayed to customers on kiosks and in emails.</li>
                  <li>All information collected from customers will be stored securely.</li>
                  <li>You can skip optional sections if you don't need them.</li>
                </ul>
                <p style={styles.disclaimerWarning}>
                  <strong>By proceeding, you acknowledge that you understand these requirements.</strong>
                </p>
              </div>
              <TavariCheckbox
                checked={disclaimerAccepted}
                onChange={(checked) => setDisclaimerAccepted(checked)}
                label="I understand and agree to the above terms"
                style={{ marginTop: TavariStyles.spacing.lg }}
              />
            </div>
          )}

          {/* Step 1: Waiver Title */}
          {wizardStep === 1 && (
            <div style={styles.stepContainer}>
              <h3 style={styles.stepTitle}>Waiver Title</h3>
              <p style={styles.stepDescription}>
                This title will be shown to customers on the kiosk and in emails when the waiver is sent.
              </p>
              {businessData?.name && (
                <div style={styles.autoFillHint}>
                  <p style={styles.autoFillText}>
                    Auto-filled from business: <strong>{businessData.name}</strong>
                  </p>
                  <p style={styles.autoFillSubtext}>
                    You can edit this field to customize the title
                  </p>
                </div>
              )}
              <div style={styles.field}>
                <label style={styles.label}>Waiver Title *</label>
                <input
                  type="text"
                  value={templateData.waiverTitle}
                  onChange={(e) => setTemplateData({ ...templateData, waiverTitle: e.target.value })}
                  style={styles.input}
                  placeholder={businessData?.name ? `${businessData.name} Liability Waiver` : "e.g., Liability Release and Assumption of Risk"}
                />
              </div>
            </div>
          )}

          {/* Step 2: Logo — defaults from Settings (app_branding); upload only to override */}
          {wizardStep === 2 && (
            <div style={styles.stepContainer}>
              <h3 style={styles.stepTitle}>Logo</h3>
              <p style={styles.stepDescription}>
                Your logo from <strong>Settings → Colors and branding</strong> is used automatically on this waiver.
                Upload a different image only if you want a template-specific logo.
              </p>
              {brandingLogoUrl && templateData.logoUrl === brandingLogoUrl && (
                <div style={styles.autoFillHint}>
                  <p style={styles.autoFillText}>
                    Using business logo from Settings
                  </p>
                </div>
              )}
              <div
                style={styles.uploadArea}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
                {templateData.logoUrl ? (
                  <div style={styles.logoPreview}>
                    <img src={templateData.logoUrl} alt="Logo" style={styles.logoImage} />
                    <div style={styles.logoActions}>
                      <button
                        type="button"
                        onClick={() => setTemplateData({ ...templateData, logoUrl: '' })}
                        style={styles.removeButton}
                      >
                        Remove
                      </button>
                      {brandingLogoUrl && templateData.logoUrl !== brandingLogoUrl && (
                        <button
                          type="button"
                          onClick={() => setTemplateData({ ...templateData, logoUrl: brandingLogoUrl })}
                          style={styles.useSettingsButton}
                        >
                          Use Settings logo
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={styles.logoEmptyColumn}>
                    {brandingLogoUrl ? (
                      <button
                        type="button"
                        onClick={() => setTemplateData({ ...templateData, logoUrl: brandingLogoUrl })}
                        style={styles.useSettingsPrimaryButton}
                      >
                        Use logo from Settings
                      </button>
                    ) : null}
                    <div
                      style={styles.uploadPlaceholder}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploadingLogo ? (
                        <p>Uploading...</p>
                      ) : (
                        <>
                          <FiUpload size={48} style={{ color: TavariStyles.colors.gray400, marginBottom: TavariStyles.spacing.md }} />
                          <p>{brandingLogoUrl ? 'Or upload a different image' : 'Click to upload or drag and drop'}</p>
                          <p style={styles.uploadHint}>PNG, JPG up to 5MB</p>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Waiver Body */}
          {wizardStep === 3 && (
            <div style={styles.stepContainer}>
              <h3 style={styles.stepTitle}>Waiver Body Content</h3>
              <p style={styles.stepDescription}>
                Paste your complete waiver text in the field below.
              </p>
              <div style={styles.field}>
                <label style={styles.label}>Waiver Content *</label>
                <textarea
                  value={templateData.waiverContent}
                  onChange={(e) => setTemplateData({ ...templateData, waiverContent: e.target.value })}
                  style={styles.textarea}
                  placeholder="Paste your waiver text here..."
                  rows={15}
                />
              </div>
            </div>
          )}

          {/* Step 4: Participants */}
          {wizardStep === 4 && (
            <div style={styles.stepContainer}>
              <h3 style={styles.stepTitle}>Participant Information</h3>
              <p style={styles.stepDescription}>
                Select which information fields you want customers to fill in (optional section - you can skip this).
              </p>
              <div style={styles.checkboxGrid}>
                <TavariCheckbox
                  checked={templateData.participantFields.firstName}
                  onChange={(checked) => setTemplateData({
                    ...templateData,
                    participantFields: { ...templateData.participantFields, firstName: checked }
                  })}
                  label="First Name"
                />
                <TavariCheckbox
                  checked={templateData.participantFields.lastName}
                  onChange={(checked) => setTemplateData({
                    ...templateData,
                    participantFields: { ...templateData.participantFields, lastName: checked }
                  })}
                  label="Last Name"
                />
                <TavariCheckbox
                  checked={templateData.participantFields.phoneNumber}
                  onChange={(checked) => setTemplateData({
                    ...templateData,
                    participantFields: { ...templateData.participantFields, phoneNumber: checked }
                  })}
                  label="Phone Number"
                />
                <TavariCheckbox
                  checked={templateData.participantFields.emailAddress}
                  onChange={(checked) => setTemplateData({
                    ...templateData,
                    participantFields: { ...templateData.participantFields, emailAddress: checked }
                  })}
                  label="Email Address"
                />
                <TavariCheckbox
                  checked={templateData.participantFields.birthdate}
                  onChange={(checked) => setTemplateData({
                    ...templateData,
                    participantFields: { ...templateData.participantFields, birthdate: checked }
                  })}
                  label="Birthdate"
                />
                <TavariCheckbox
                  checked={templateData.participantFields.address}
                  onChange={(checked) => setTemplateData({
                    ...templateData,
                    participantFields: { ...templateData.participantFields, address: checked }
                  })}
                  label="Address"
                />
                <TavariCheckbox
                  checked={templateData.participantFields.postalCode}
                  onChange={(checked) => setTemplateData({
                    ...templateData,
                    participantFields: { ...templateData.participantFields, postalCode: checked }
                  })}
                  label="Postal Code"
                />
              </div>
            </div>
          )}

          {/* Step 5: Minor Information */}
          {wizardStep === 5 && (
            <div style={styles.stepContainer}>
              <h3 style={styles.stepTitle}>Minor Information</h3>
              <p style={styles.stepDescription}>
                Select which information fields you want for minors (optional section - you can skip this).
              </p>
              <div style={styles.checkboxGrid}>
                <TavariCheckbox
                  checked={templateData.minorFields.firstName}
                  onChange={(checked) => setTemplateData({
                    ...templateData,
                    minorFields: { ...templateData.minorFields, firstName: checked }
                  })}
                  label="First Name"
                />
                <TavariCheckbox
                  checked={templateData.minorFields.lastName}
                  onChange={(checked) => setTemplateData({
                    ...templateData,
                    minorFields: { ...templateData.minorFields, lastName: checked }
                  })}
                  label="Last Name"
                />
                <TavariCheckbox
                  checked={templateData.minorFields.birthdate}
                  onChange={(checked) => setTemplateData({
                    ...templateData,
                    minorFields: { ...templateData.minorFields, birthdate: checked }
                  })}
                  label="Birthdate"
                />
              </div>
            </div>
          )}

          {/* Step 6: Signature */}
          {wizardStep === 6 && (
            <div style={styles.stepContainer}>
              <h3 style={styles.stepTitle}>Signature Requirements</h3>
              <p style={styles.stepDescription}>
                Configure signature requirements for the waiver.
              </p>
              <div style={styles.field}>
                <TavariCheckbox
                  checked={templateData.signatureRequired}
                  onChange={(checked) => setTemplateData({ ...templateData, signatureRequired: checked })}
                  label="Require digital signature"
                />
                <p style={styles.helpText}>
                  If enabled, customers must provide a digital signature to complete the waiver.
                </p>
              </div>
            </div>
          )}

          {/* Step 7: Notifications */}
          {wizardStep === 7 && (
            <div style={styles.stepContainer}>
              <h3 style={styles.stepTitle}>Notifications & Communications</h3>
              <p style={styles.stepDescription}>
                Configure how customers receive their waiver and reminder notifications.
              </p>
              <div style={styles.checkboxSection}>
                <h4 style={styles.subsectionTitle}>After Signing</h4>
                <div style={styles.checkboxGrid}>
                  <TavariCheckbox
                    checked={templateData.notifications.emailCopy}
                    onChange={(checked) => setTemplateData({
                      ...templateData,
                      notifications: { ...templateData.notifications, emailCopy: checked }
                    })}
                    label="Send email copy of signed waiver"
                  />
                  <TavariCheckbox
                    checked={templateData.notifications.sendLinkEmail}
                    onChange={(checked) => setTemplateData({
                      ...templateData,
                      notifications: { ...templateData.notifications, sendLinkEmail: checked }
                    })}
                    label="Send waiver link via email"
                  />
                  <TavariCheckbox
                    checked={templateData.notifications.sendLinkSMS}
                    onChange={(checked) => setTemplateData({
                      ...templateData,
                      notifications: { ...templateData.notifications, sendLinkSMS: checked }
                    })}
                    label="Send waiver link via SMS"
                  />
                </div>
              </div>
              <div style={styles.checkboxSection}>
                <h4 style={styles.subsectionTitle}>Reminders (30 days before expiry)</h4>
                <div style={styles.checkboxGrid}>
                  <TavariCheckbox
                    checked={templateData.notifications.reminderEmail}
                    onChange={(checked) => setTemplateData({
                      ...templateData,
                      notifications: { ...templateData.notifications, reminderEmail: checked }
                    })}
                    label="Send reminder via email"
                  />
                  <TavariCheckbox
                    checked={templateData.notifications.reminderSMS}
                    onChange={(checked) => setTemplateData({
                      ...templateData,
                      notifications: { ...templateData.notifications, reminderSMS: checked }
                    })}
                    label="Send reminder via SMS"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={styles.footer}>
          {wizardStep > 0 && (
            <button onClick={prevStep} style={styles.backButton}>
              <FiArrowLeft /> Back
            </button>
          )}
          <div style={styles.footerRight}>
            {wizardStep < 7 && wizardStep > 3 && (
              <button onClick={skipStep} style={styles.skipButton}>
                Skip This Section
              </button>
            )}
            {wizardStep === 0 ? (
              <button
                onClick={nextStep}
                style={styles.nextButton}
                disabled={!disclaimerAccepted}
              >
                I Understand <FiArrowRight />
              </button>
            ) : wizardStep < 7 ? (
              <button onClick={nextStep} style={styles.nextButton}>
                Next <FiArrowRight />
              </button>
            ) : (
              <button onClick={handleSave} style={styles.saveButton}>
                {isEditing ? 'Update Template' : 'Create Template'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: TavariStyles.spacing.md
  },
  modal: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    width: '100%',
    maxWidth: '800px',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: TavariStyles.shadows.xl
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: TavariStyles.spacing.lg,
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`
  },
  title: {
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: '600',
    color: TavariStyles.colors.text,
    margin: 0
  },
  closeButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: TavariStyles.spacing.xs,
    color: TavariStyles.colors.gray600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  progress: {
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`
  },
  progressBar: {
    width: '100%',
    height: '8px',
    backgroundColor: TavariStyles.colors.gray200,
    borderRadius: TavariStyles.borderRadius.full,
    overflow: 'hidden',
    marginBottom: TavariStyles.spacing.xs
  },
  progressFill: {
    height: '100%',
    backgroundColor: TavariStyles.colors.primary,
    transition: 'width 0.3s ease'
  },
  progressText: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    margin: 0,
    textAlign: 'center'
  },
  content: {
    padding: TavariStyles.spacing.xl,
    overflowY: 'auto',
    flex: 1
  },
  stepContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.md
  },
  stepTitle: {
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: '600',
    color: TavariStyles.colors.text,
    margin: 0,
    marginBottom: TavariStyles.spacing.xs
  },
  stepDescription: {
    fontSize: TavariStyles.typography.fontSize.base,
    color: TavariStyles.colors.gray600,
    margin: 0,
    marginBottom: TavariStyles.spacing.lg
  },
  field: {
    marginBottom: TavariStyles.spacing.lg
  },
  label: {
    display: 'block',
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: '500',
    color: TavariStyles.colors.text,
    marginBottom: TavariStyles.spacing.xs
  },
  input: {
    width: '100%',
    padding: TavariStyles.spacing.md,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: TavariStyles.typography.fontSize.base,
    fontFamily: 'inherit'
  },
  textarea: {
    width: '100%',
    padding: TavariStyles.spacing.md,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: TavariStyles.typography.fontSize.base,
    fontFamily: 'inherit',
    resize: 'vertical',
    minHeight: '300px'
  },
  helpText: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray500,
    marginTop: TavariStyles.spacing.xs,
    marginBottom: 0
  },
  disclaimerBox: {
    backgroundColor: TavariStyles.colors.gray50,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    padding: TavariStyles.spacing.lg,
    marginBottom: TavariStyles.spacing.md
  },
  disclaimerText: {
    fontSize: TavariStyles.typography.fontSize.base,
    color: TavariStyles.colors.text,
    marginBottom: TavariStyles.spacing.md
  },
  disclaimerList: {
    fontSize: TavariStyles.typography.fontSize.base,
    color: TavariStyles.colors.text,
    marginLeft: TavariStyles.spacing.lg,
    marginBottom: TavariStyles.spacing.md
  },
  disclaimerWarning: {
    fontSize: TavariStyles.typography.fontSize.base,
    color: TavariStyles.colors.error,
    marginTop: TavariStyles.spacing.md,
    marginBottom: 0
  },
  uploadArea: {
    border: `2px dashed ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    padding: TavariStyles.spacing.xl,
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'border-color 0.2s'
  },
  uploadPlaceholder: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '200px',
    color: TavariStyles.colors.gray600
  },
  uploadHint: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray500,
    marginTop: TavariStyles.spacing.xs
  },
  logoPreview: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: TavariStyles.spacing.md
  },
  logoImage: {
    maxWidth: '300px',
    maxHeight: '200px',
    objectFit: 'contain'
  },
  removeButton: {
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    backgroundColor: TavariStyles.colors.error,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.sm
  },
  logoActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: TavariStyles.spacing.sm,
    justifyContent: 'center',
    alignItems: 'center'
  },
  useSettingsButton: {
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.primary,
    border: `1px solid ${TavariStyles.colors.primary}`,
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.sm
  },
  useSettingsPrimaryButton: {
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: '600',
    marginBottom: TavariStyles.spacing.sm
  },
  logoEmptyColumn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: '100%'
  },
  checkboxGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.md
  },
  autoFillHint: {
    padding: TavariStyles.spacing.md,
    backgroundColor: '#EFF6FF',
    borderRadius: TavariStyles.borderRadius.md,
    border: '1px solid #93C5FD',
    marginBottom: TavariStyles.spacing.md
  },
  autoFillText: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.text,
    margin: 0,
    marginBottom: '0.25rem'
  },
  autoFillSubtext: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray600,
    margin: 0
  },
  checkboxSection: {
    marginBottom: TavariStyles.spacing.xl
  },
  subsectionTitle: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: '600',
    color: TavariStyles.colors.text,
    margin: 0,
    marginBottom: TavariStyles.spacing.md
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: TavariStyles.spacing.lg,
    borderTop: `1px solid ${TavariStyles.colors.gray200}`
  },
  footerRight: {
    display: 'flex',
    gap: TavariStyles.spacing.md,
    alignItems: 'center'
  },
  backButton: {
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
    backgroundColor: TavariStyles.colors.gray100,
    color: TavariStyles.colors.text,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: '500',
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm
  },
  skipButton: {
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
    backgroundColor: 'transparent',
    color: TavariStyles.colors.gray600,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: '500'
  },
  nextButton: {
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: '600',
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm
  },
  saveButton: {
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: '600'
  }
};

export default WaiverTemplateWizard;

