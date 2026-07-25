// Step 87: Create WaiverUploadScreen.jsx
// Upload paper waivers
import React, { useState, useEffect } from 'react';
import { FiUpload, FiFile, FiX } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useSecurityContext } from '../../Security/useSecurityContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useWaiversShellStyle } from '../../contexts/WaiversShellContext';
import WaiverStorageService from '../../services/Waivers/WaiverStorageService';
import toast from 'react-hot-toast';

const WaiverUploadScreen = () => {
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner', 'admin'], // Only managers/owners can upload paper waivers
    requireBusiness: true,
    componentName: 'WaiverUploadScreen'
  });

  const { hasPermission, hasElevatedPrivileges } = usePermissions();
  const containerStyle = useWaiversShellStyle(styles.container);
  const contentStyle = useWaiversShellStyle(styles.content);
  const security = useSecurityContext({
    enableRateLimiting: true,
    enableDeviceTracking: true,
    enableInputValidation: true,
    enableAuditLogging: true,
    componentName: 'WaiverUploadScreen',
    sensitiveComponent: true
  });

  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [participantData, setParticipantData] = useState({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    phoneNumber: '',
    email: '',
    waiverFilledDate: ''
  });

  useEffect(() => {
    if (auth.selectedBusinessId) {
      WaiverStorageService.setBusinessId(auth.selectedBusinessId);
    }
  }, [auth.selectedBusinessId]);

  const canUpload = hasPermission('waivers.upload') || hasElevatedPrivileges();

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 50 * 1024 * 1024) { // 50MB
        toast.error('File size must be less than 50MB');
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error('Please select a file');
      return;
    }

    if (!participantData.firstName || !participantData.lastName) {
      toast.error('Please enter participant name');
      return;
    }

    if (!participantData.waiverFilledDate) {
      toast.error('Please enter the date the waiver was filled');
      return;
    }

    try {
      setUploading(true);
      await WaiverStorageService.uploadPaperWaiver(selectedFile, participantData);
      toast.success('Waiver uploaded successfully');
      setSelectedFile(null);
      setParticipantData({
        firstName: '',
        lastName: '',
        dateOfBirth: '',
        phoneNumber: '',
        email: '',
        waiverFilledDate: ''
      });
    } catch (error) {
      console.error('Error uploading waiver:', error);
      toast.error('Error uploading waiver');
    } finally {
      setUploading(false);
    }
  };

  if (auth.authLoading) {
    return (
      <POSAuthWrapper componentName="WaiverUploadScreen">
        <div style={TavariStyles.loadingContainer}>
          <p>Loading...</p>
        </div>
      </POSAuthWrapper>
    );
  }

  if (!canUpload) {
    return (
      <POSAuthWrapper componentName="WaiverUploadScreen">
        <div style={TavariStyles.errorContainer}>
          <h2>Access Denied</h2>
          <p>You do not have permission to upload waivers.</p>
        </div>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper componentName="WaiverUploadScreen">
      <SecurityWrapper componentName="WaiverUploadScreen" sensitiveComponent={true}>
        <div style={containerStyle}>
          <div style={styles.header}>
            <FiUpload size={32} style={styles.headerIcon} />
            <h1 style={styles.title}>Upload Paper Waiver</h1>
            <p style={styles.subtitle}>Upload scanned or photographed paper waivers</p>
          </div>

          <div style={contentStyle}>
            <div style={styles.uploadSection}>
              <h3 style={styles.sectionTitle}>Select File</h3>
              <div style={styles.fileUploadArea}>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.gif,.webp"
                  onChange={handleFileSelect}
                  style={styles.fileInput}
                  id="waiver-upload"
                />
                <label htmlFor="waiver-upload" style={styles.fileLabel}>
                  {selectedFile ? (
                    <>
                      <FiFile size={24} />
                      <span>{selectedFile.name}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedFile(null);
                        }}
                        style={styles.removeButton}
                      >
                        <FiX />
                      </button>
                    </>
                  ) : (
                    <>
                      <FiUpload size={24} />
                      <span>Click to select file or drag and drop</span>
                      <p style={styles.fileHint}>PDF, PNG, JPG, GIF, WEBP (Max 50MB)</p>
                    </>
                  )}
                </label>
              </div>
            </div>

            <div style={styles.formSection}>
              <h3 style={styles.sectionTitle}>Participant Information</h3>
              <div style={styles.formGrid}>
                <div style={styles.formField}>
                  <label style={styles.label}>First Name *</label>
                  <input
                    type="text"
                    value={participantData.firstName}
                    onChange={(e) => setParticipantData(prev => ({ ...prev, firstName: e.target.value }))}
                    style={styles.input}
                    required
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Last Name *</label>
                  <input
                    type="text"
                    value={participantData.lastName}
                    onChange={(e) => setParticipantData(prev => ({ ...prev, lastName: e.target.value }))}
                    style={styles.input}
                    required
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Date of Birth</label>
                  <input
                    type="date"
                    value={participantData.dateOfBirth}
                    onChange={(e) => setParticipantData(prev => ({ ...prev, dateOfBirth: e.target.value }))}
                    style={styles.input}
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Phone Number</label>
                  <input
                    type="tel"
                    value={participantData.phoneNumber}
                    onChange={(e) => setParticipantData(prev => ({ ...prev, phoneNumber: e.target.value }))}
                    style={styles.input}
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Email</label>
                  <input
                    type="email"
                    value={participantData.email}
                    onChange={(e) => setParticipantData(prev => ({ ...prev, email: e.target.value }))}
                    style={styles.input}
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Waiver Filled Date *</label>
                  <input
                    type="date"
                    value={participantData.waiverFilledDate}
                    onChange={(e) => setParticipantData(prev => ({ ...prev, waiverFilledDate: e.target.value }))}
                    style={styles.input}
                    required
                    max={new Date().toISOString().split('T')[0]}
                  />
                  <p style={styles.helpText}>The date the waiver was actually filled/signed by the participant</p>
                </div>
              </div>
            </div>

            <button
              onClick={handleUpload}
              disabled={uploading || !selectedFile}
              style={{
                ...styles.uploadButton,
                ...((uploading || !selectedFile) && styles.uploadButtonDisabled)
              }}
            >
              <FiUpload /> {uploading ? 'Uploading...' : 'Upload Waiver'}
            </button>
          </div>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: TavariStyles.colors.background,
    padding: TavariStyles.spacing.xl,
    paddingTop: 0
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
    color: TavariStyles.colors.text,
    marginBottom: TavariStyles.spacing.sm
  },
  subtitle: {
    fontSize: TavariStyles.typography.fontSize.base,
    color: TavariStyles.colors.gray600
  },
  content: {
    maxWidth: '800px',
    margin: '0 auto',
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: TavariStyles.spacing.xl,
    boxShadow: TavariStyles.shadows.sm
  },
  uploadSection: {
    marginBottom: TavariStyles.spacing.xl
  },
  sectionTitle: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: '600',
    color: TavariStyles.colors.text,
    marginBottom: TavariStyles.spacing.md
  },
  fileUploadArea: {
    position: 'relative'
  },
  fileInput: {
    position: 'absolute',
    opacity: 0,
    width: 0,
    height: 0
  },
  fileLabel: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: TavariStyles.spacing.xl,
    border: `2px dashed ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    transition: 'all 0.2s',
    gap: TavariStyles.spacing.sm
  },
  fileHint: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray500,
    margin: 0
  },
  removeButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: TavariStyles.colors.error,
    padding: TavariStyles.spacing.xs
  },
  formSection: {
    marginBottom: TavariStyles.spacing.xl
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: TavariStyles.spacing.md
  },
  formField: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.xs
  },
  label: {
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: '600',
    color: TavariStyles.colors.text
  },
  input: {
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.sm,
    fontSize: TavariStyles.typography.fontSize.base
  },
  helpText: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray500,
    marginTop: TavariStyles.spacing.xs,
    marginBottom: 0,
    fontStyle: 'italic'
  },
  uploadButton: {
    width: '100%',
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: TavariStyles.spacing.sm,
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: '600'
  },
  uploadButtonDisabled: {
    backgroundColor: TavariStyles.colors.gray300,
    cursor: 'not-allowed',
    opacity: 0.6
  }
};

export default WaiverUploadScreen;

