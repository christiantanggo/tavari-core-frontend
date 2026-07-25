// components/HR/HREmployeeProfilesComponents/EmployeeContractModal.jsx
import React, { useState, useRef, useEffect } from 'react';
import { X, Upload, FileText, AlertCircle, CheckCircle, Loader, Trash2, Eye } from 'lucide-react';
import { supabase } from '../../../supabaseClient';
import { TavariStyles } from '../../../utils/TavariStyles';
import toast from 'react-hot-toast';

const EmployeeContractModal = ({ isOpen, onClose, employee, businessId, authUser, onContractUploaded }) => {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [contractFile, setContractFile] = useState(null);
  const [contractName, setContractName] = useState('');
  const [existingContracts, setExistingContracts] = useState([]);
  const [loadingContracts, setLoadingContracts] = useState(false);
  const [deletingContractId, setDeletingContractId] = useState(null);
  const fileInputRef = useRef(null);

  // Load existing contracts when modal opens
  useEffect(() => {
    if (isOpen && employee?.email) {
      loadExistingContracts();
    }
  }, [isOpen, employee?.email]);

  const loadExistingContracts = async () => {
    if (!employee?.email) return;

    setLoadingContracts(true);
    try {
      const { data, error } = await supabase
        .from('hr_contracts')
        .select('id, file_name, file_size, uploaded_at, storage_path, signing_token, status')
        .eq('employee_email', employee.email)
        .in('status', ['signed', 'legacy'])
        .order('uploaded_at', { ascending: false });

      if (error) {
        console.error('Error loading contracts:', error);
        toast.error('Failed to load contracts');
      } else {
        setExistingContracts(data || []);
      }
    } catch (error) {
      console.error('Error loading contracts:', error);
    } finally {
      setLoadingContracts(false);
    }
  };

  const handleDeleteContract = async (contractId, storagePath) => {
    if (!confirm('Are you sure you want to delete this contract? This action cannot be undone.')) {
      return;
    }

    setDeletingContractId(contractId);
    try {
      // Delete file from storage if storage_path exists
      if (storagePath) {
        const { error: storageError } = await supabase.storage
          .from('hr-documents')
          .remove([storagePath]);

        if (storageError) {
          console.warn('Error deleting file from storage:', storageError);
          // Continue with database deletion even if storage delete fails
        }
      }

      // Delete contract record from database
      const { error: dbError } = await supabase
        .from('hr_contracts')
        .delete()
        .eq('id', contractId);

      if (dbError) {
        throw new Error(`Failed to delete contract: ${dbError.message}`);
      }

      toast.success('Contract deleted successfully');
      
      // Reload contracts list
      await loadExistingContracts();
      
      // Call callback to refresh parent component
      if (onContractUploaded) {
        onContractUploaded(null); // Pass null to indicate deletion
      }
    } catch (error) {
      console.error('Error deleting contract:', error);
      toast.error('Failed to delete contract: ' + error.message);
    } finally {
      setDeletingContractId(null);
    }
  };

  const handleViewContract = (signingToken) => {
    window.open(`/contract/view/${signingToken}`, '_blank');
  };

  if (!isOpen) return null;

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file type
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('Please select a PDF file');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File size must be less than 10MB');
      return;
    }

    setContractFile(file);
    setContractName(file.name);
    setUploadError(null);
  };

  const handleUpload = async () => {
    if (!contractFile) {
      setUploadError('Please select a file to upload');
      return;
    }

    if (!businessId || !authUser || !employee) {
      setUploadError('Missing required information');
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      // Generate unique file path
      const timestamp = Date.now();
      const sanitizedFileName = contractFile.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = `contracts/${businessId}/${employee.id || employee.email}/${timestamp}_${sanitizedFileName}`;

      // Upload file to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('hr-documents')
        .upload(filePath, contractFile, {
          cacheControl: '3600',
          upsert: false,
          contentType: 'application/pdf'
        });

      if (uploadError) {
        throw new Error(`Upload failed: ${uploadError.message}`);
      }

      // For private buckets, we store the storage_path and generate signed URLs when viewing
      // Don't use getPublicUrl for private buckets

      // Create contract record in database
      // Use employee's hire_date for start_date if available, otherwise use a default
      const startDate = employee.hire_date || employee.hireDate || new Date().toISOString().split('T')[0];
      
      const contractData = {
        business_id: businessId,
        employee_id: employee.id || null,
        employee_email: employee.email,
        employee_first_name: employee.first_name || employee.firstName,
        employee_last_name: employee.last_name || employee.lastName,
        contract_type: 'employment', // Required field - default is 'employment'
        status: 'signed', // Use 'signed' status since legacy contracts are already signed
        start_date: startDate, // Required field - use hire_date or current date
        signing_token: `legacy_${Date.now()}_${Math.random().toString(36).substring(7)}`, // Required field - unique token
        pdf_url: null, // Will generate signed URL when viewing
        storage_path: filePath, // Store the path for generating signed URLs
        file_name: contractFile.name,
        file_size: contractFile.size,
        uploaded_by: authUser.id,
        uploaded_at: new Date().toISOString(),
        // Set contract as signed since it's a legacy document
        signed_at: new Date().toISOString(),
        // Set expiration far in the future for legacy contracts
        expires_at: new Date('2099-12-31').toISOString(),
        // Add required fields for legacy contracts (if they exist)
        contract_data: {}, // Empty JSONB for legacy contracts
        contract_html: '<p>Legacy contract uploaded from external source</p>' // Minimal HTML
      };

      const { data: contractRecord, error: dbError } = await supabase
        .from('hr_contracts')
        .insert(contractData)
        .select()
        .single();

      if (dbError) {
        // If insert fails, try to delete the uploaded file
        await supabase.storage
          .from('hr-documents')
          .remove([filePath]);
        throw new Error(`Database save failed: ${dbError.message}`);
      }

      toast.success('Legacy contract uploaded successfully!');
      
      // Call callback to refresh contract list
      if (onContractUploaded) {
        onContractUploaded(contractRecord);
      }

      // Reload contracts list
      await loadExistingContracts();

      // Reset form (but don't close modal so user can see the new contract)
      setContractFile(null);
      setContractName('');
      setUploadError(null);
    } catch (error) {
      console.error('Error uploading contract:', error);
      setUploadError(error.message || 'Failed to upload contract');
      toast.error('Failed to upload contract: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveFile = () => {
    setContractFile(null);
    setContractName('');
    setUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
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
      padding: '20px'
    },
    modal: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      width: '100%',
      maxWidth: '600px',
      maxHeight: '90vh',
      overflow: 'auto',
      boxShadow: TavariStyles.shadows?.xl || '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '24px',
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`
    },
    title: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      margin: 0
    },
    closeButton: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '4px',
      display: 'flex',
      alignItems: 'center',
      color: TavariStyles.colors.gray500,
      transition: 'color 0.2s'
    },
    content: {
      padding: '24px'
    },
    noContractMessage: {
      backgroundColor: TavariStyles.colors.warning + '10',
      border: `1px solid ${TavariStyles.colors.warning}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      padding: '20px',
      marginBottom: '24px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '12px'
    },
    messageText: {
      flex: 1,
      color: TavariStyles.colors.gray700,
      fontSize: TavariStyles.typography.fontSize.base
    },
    uploadSection: {
      marginTop: '24px'
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: '16px'
    },
    fileInputWrapper: {
      border: `2px dashed ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      padding: '32px',
      textAlign: 'center',
      cursor: 'pointer',
      transition: 'all 0.2s',
      backgroundColor: TavariStyles.colors.gray50
    },
    fileInput: {
      display: 'none'
    },
    fileInputLabel: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '12px',
      cursor: 'pointer'
    },
    uploadIcon: {
      color: TavariStyles.colors.primary
    },
    fileInfo: {
      marginTop: '16px',
      padding: '16px',
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px'
    },
    fileName: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      color: TavariStyles.colors.gray700,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    removeButton: {
      background: 'none',
      border: 'none',
      color: TavariStyles.colors.danger,
      cursor: 'pointer',
      padding: '4px 8px',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    errorMessage: {
      marginTop: '12px',
      padding: '12px',
      backgroundColor: TavariStyles.colors.danger + '10',
      border: `1px solid ${TavariStyles.colors.danger}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      color: TavariStyles.colors.danger,
      fontSize: TavariStyles.typography.fontSize.sm,
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    },
    footer: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '12px',
      padding: '24px',
      borderTop: `1px solid ${TavariStyles.colors.gray200}`
    },
    button: {
      padding: '10px 20px',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      cursor: 'pointer',
      border: 'none',
      transition: 'all 0.2s',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    },
    cancelButton: {
      padding: '10px 20px',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      cursor: 'pointer',
      border: 'none',
      transition: 'all 0.2s',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      backgroundColor: TavariStyles.colors.gray100,
      color: TavariStyles.colors.gray700
    },
    uploadButton: {
      padding: '10px 20px',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      cursor: 'pointer',
      border: 'none',
      transition: 'all 0.2s',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white
    },
    disabledButton: {
      opacity: 0.6,
      cursor: 'not-allowed'
    }
  };

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>Employee Contract</h2>
          <button onClick={onClose} style={styles.closeButton}>
            <X size={24} />
          </button>
        </div>

        <div style={styles.content}>
          {/* Existing Contracts Section */}
          {loadingContracts ? (
            <div style={{ padding: '20px', textAlign: 'center' }}>
              <Loader size={24} style={{ animation: 'spin 1s linear infinite', margin: '0 auto' }} />
              <p style={{ marginTop: '12px', color: TavariStyles.colors.gray600 }}>Loading contracts...</p>
            </div>
          ) : existingContracts.length > 0 ? (
            <div style={{ marginBottom: '24px' }}>
              <h3 style={styles.sectionTitle}>Existing Contracts</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {existingContracts.map((contract) => (
                  <div
                    key={contract.id}
                    style={{
                      padding: '16px',
                      border: `1px solid ${TavariStyles.colors.gray200}`,
                      borderRadius: TavariStyles.borderRadius?.md || '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px'
                    }}
                  >
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <FileText size={20} style={{ color: TavariStyles.colors.primary }} />
                      <div>
                        <div style={{ fontWeight: TavariStyles.typography.fontWeight.medium, color: TavariStyles.colors.gray800 }}>
                          {contract.file_name || 'Contract PDF'}
                        </div>
                        <div style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, marginTop: '4px' }}>
                          Uploaded: {new Date(contract.uploaded_at).toLocaleDateString()}
                          {contract.file_size && ` • ${(contract.file_size / 1024).toFixed(1)} KB`}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => handleViewContract(contract.signing_token)}
                        style={{
                          padding: '8px 12px',
                          borderRadius: TavariStyles.borderRadius?.sm || '6px',
                          border: `1px solid ${TavariStyles.colors.gray300}`,
                          backgroundColor: TavariStyles.colors.white,
                          color: TavariStyles.colors.gray700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: TavariStyles.typography.fontSize.sm
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = TavariStyles.colors.gray50;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = TavariStyles.colors.white;
                        }}
                      >
                        <Eye size={16} />
                        View
                      </button>
                      <button
                        onClick={() => handleDeleteContract(contract.id, contract.storage_path)}
                        disabled={deletingContractId === contract.id}
                        style={{
                          padding: '8px 12px',
                          borderRadius: TavariStyles.borderRadius?.sm || '6px',
                          border: `1px solid ${TavariStyles.colors.danger}`,
                          backgroundColor: deletingContractId === contract.id ? TavariStyles.colors.gray100 : TavariStyles.colors.white,
                          color: TavariStyles.colors.danger,
                          cursor: deletingContractId === contract.id ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: TavariStyles.typography.fontSize.sm,
                          opacity: deletingContractId === contract.id ? 0.6 : 1
                        }}
                        onMouseEnter={(e) => {
                          if (deletingContractId !== contract.id) {
                            e.currentTarget.style.backgroundColor = TavariStyles.colors.danger + '10';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (deletingContractId !== contract.id) {
                            e.currentTarget.style.backgroundColor = TavariStyles.colors.white;
                          }
                        }}
                      >
                        {deletingContractId === contract.id ? (
                          <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} />
                        ) : (
                          <Trash2 size={16} />
                        )}
                        {deletingContractId === contract.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* No Contract Message */
            <div style={styles.noContractMessage}>
              <AlertCircle size={24} style={{ color: TavariStyles.colors.warning, flexShrink: 0 }} />
              <div style={styles.messageText}>
                <strong>No contract on file</strong>
                <p style={{ margin: '8px 0 0 0', fontSize: TavariStyles.typography.fontSize.sm }}>
                  {employee.first_name || employee.firstName} {employee.last_name || employee.lastName} does not have a contract in the system.
                  {contractFile ? ' You can upload a legacy contract below.' : ' You can upload a legacy contract using the button below.'}
                </p>
              </div>
            </div>
          )}

          {/* Upload Section */}
          <div style={styles.uploadSection}>
            <h3 style={styles.sectionTitle}>Upload Legacy Contract</h3>
            <p style={{ color: TavariStyles.colors.gray600, fontSize: TavariStyles.typography.fontSize.sm, marginBottom: '16px' }}>
              Upload a PDF file of an existing contract that was signed outside of the system.
            </p>

            {!contractFile ? (
              <div
                style={styles.fileInputWrapper}
                onClick={() => fileInputRef.current?.click()}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = TavariStyles.colors.primary;
                  e.currentTarget.style.backgroundColor = TavariStyles.colors.primary + '05';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = TavariStyles.colors.gray300;
                  e.currentTarget.style.backgroundColor = TavariStyles.colors.gray50;
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={handleFileSelect}
                  style={styles.fileInput}
                />
                <label style={styles.fileInputLabel}>
                  <Upload size={48} style={styles.uploadIcon} />
                  <div>
                    <strong style={{ color: TavariStyles.colors.gray700 }}>
                      Click to upload or drag and drop
                    </strong>
                    <p style={{ color: TavariStyles.colors.gray500, fontSize: TavariStyles.typography.fontSize.sm, margin: '4px 0 0 0' }}>
                      PDF files only (max 10MB)
                    </p>
                  </div>
                </label>
              </div>
            ) : (
              <div style={styles.fileInfo}>
                <div style={styles.fileName}>
                  <FileText size={20} style={{ color: TavariStyles.colors.primary }} />
                  <span>{contractName}</span>
                </div>
                <button onClick={handleRemoveFile} style={styles.removeButton}>
                  Remove
                </button>
              </div>
            )}

            {uploadError && (
              <div style={styles.errorMessage}>
                <AlertCircle size={16} />
                {uploadError}
              </div>
            )}
          </div>
        </div>

        <div style={styles.footer}>
          <button
            onClick={onClose}
            style={styles.cancelButton}
            disabled={uploading}
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            style={{
              ...styles.uploadButton,
              ...(uploading || !contractFile ? styles.disabledButton : {})
            }}
            disabled={uploading || !contractFile}
          >
            {uploading ? (
              <>
                <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} />
                Uploading...
              </>
            ) : (
              <>
                <Upload size={18} />
                Upload Contract
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EmployeeContractModal;

