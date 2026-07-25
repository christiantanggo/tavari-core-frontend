// components/HR/HREmployeeProfilesComponents/EmployeeCertificateManagementModal.jsx
import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Award, AlertTriangle, Check, Calendar, FileText, Upload, Download, Eye, Lock } from 'lucide-react';
import { supabase } from '../../../supabaseClient';
import bcrypt from 'bcryptjs';
import toast from 'react-hot-toast';

// Import all required consistency files
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import POSAuthWrapper from '../../../components/Auth/POSAuthWrapper';
import TavariCheckbox from '../../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';
import PositionLabel from '../PositionLabel';

const EmployeeCertificateManagementModal = ({
  isOpen,
  onClose,
  employee,
  availableCertificates = [],
  onCertificatesUpdated
}) => {
  // Security context for sensitive certificate data
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'EmployeeCertificateManagementModal',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Authentication
  const {
    selectedBusinessId,
    authUser,
    userRole
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'EmployeeCertificateManagementModal'
  });

  // Component state
  const [currentCertificates, setCurrentCertificates] = useState([]);
  const [selectedCertificateId, setSelectedCertificateId] = useState('');
  const [newCertificateData, setNewCertificateData] = useState({
    issue_date: '',
    expiry_date: '',
    certificate_number: '',
    document_path: '',
    notes: ''
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  
  // File upload and PIN verification state
  const [uploadingFile, setUploadingFile] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinVerified, setPinVerified] = useState(false);
  const [uploadingForCertificate, setUploadingForCertificate] = useState(null);
  const [viewingCertificate, setViewingCertificate] = useState(null);

  // Load current certificates when modal opens
  useEffect(() => {
    if (isOpen && employee?.id) {
      loadCurrentCertificates();
    }
  }, [isOpen, employee?.id]);

  // Clear messages after a delay
  useEffect(() => {
    if (error || success) {
      const timer = setTimeout(() => {
        setError(null);
        setSuccess(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, success]);

  const loadCurrentCertificates = async () => {
    try {
      setLoading(true);
      setError(null);

      await logSecurityEvent('certificate_assignment_view', {
        employee_id: employee.id,
        employee_name: employee.full_name
      }, 'low');

      const { data, error: certError } = await supabase
        .from('employee_certificates')
        .select(`
          id,
          employee_id,
          certificate_id,
          business_id,
          issue_date,
          expiry_date,
          certificate_number,
          document_path,
          status,
          notes,
          created_at,
          updated_at,
          uploaded_by,
          certificate_file_url,
          hr_certificates!inner(
            id,
            name,
            description,
            issuing_authority,
            requires_renewal,
            renewal_period_months
          )
        `)
        .eq('business_id', selectedBusinessId)
        .eq('employee_id', employee.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (certError) throw certError;

      // Transform data to include expiry calculations
      const transformedCerts = (data || []).map(cert => ({
        ...cert,
        is_expired: cert.expiry_date ? new Date(cert.expiry_date) < new Date() : false,
        days_until_expiry: cert.expiry_date ? Math.ceil((new Date(cert.expiry_date) - new Date()) / (1000 * 60 * 60 * 24)) : null,
        expires_soon: cert.expiry_date ? Math.ceil((new Date(cert.expiry_date) - new Date()) / (1000 * 60 * 60 * 24)) <= 30 : false
      }));

      console.log('[Certificate] Loaded certificates:', transformedCerts.length);
      console.log('[Certificate] Certificate file URLs:', transformedCerts.map(c => ({ 
        id: c.id, 
        name: c.hr_certificates?.name, 
        has_file: !!c.certificate_file_url,
        file_url: c.certificate_file_url 
      })));
      setCurrentCertificates(transformedCerts);
    } catch (error) {
      console.error('Error loading current certificates:', error);
      setError('Failed to load current certificates: ' + error.message);
      await logSecurityEvent('certificate_assignment_load_failed', {
        employee_id: employee.id,
        error_message: error.message
      }, 'medium');
    } finally {
      setLoading(false);
    }
  };

  const handleAddCertificate = async () => {
    if (!selectedCertificateId || !newCertificateData.issue_date) {
      setError('Please select a certificate and provide an issue date');
      return;
    }

    // Rate limiting check
    const rateLimitCheck = await checkRateLimit('assign_certificate');
    if (!rateLimitCheck.allowed) {
      setError('Rate limit exceeded. Please wait before assigning another certificate.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Find the selected certificate details
      const selectedCertificate = availableCertificates.find(c => c.id === selectedCertificateId);
      if (!selectedCertificate) {
        throw new Error('Selected certificate not found');
      }

      // Check if employee already has this certificate (including inactive ones)
      // Query database to check for any existing certificate assignment
      const { data: existingCerts, error: checkError } = await supabase
        .from('employee_certificates')
        .select('id, status')
        .eq('business_id', selectedBusinessId)
        .eq('employee_id', employee.id)
        .eq('certificate_id', selectedCertificateId)
        .limit(1);

      if (checkError) {
        console.warn('[Certificate] Error checking existing certificates:', checkError);
      }

      if (existingCerts && existingCerts.length > 0) {
        const existing = existingCerts[0];
        // If it exists but is inactive, reactivate it instead of creating duplicate
        if (existing.status === 'inactive') {
          const { error: updateError } = await supabase
            .from('employee_certificates')
            .update({
              issue_date: newCertificateData.issue_date,
              expiry_date: newCertificateData.expiry_date || null,
              certificate_number: newCertificateData.certificate_number || null,
              document_path: newCertificateData.document_path || null,
              notes: newCertificateData.notes || null,
              status: 'active',
              updated_at: new Date().toISOString()
            })
            .eq('id', existing.id);

          if (updateError) throw updateError;

          await loadCurrentCertificates();
          setSuccess(`${selectedCertificate.name} certificate reactivated successfully`);
          toast.success(`${selectedCertificate.name} certificate reactivated successfully`);
          setShowAddForm(false);
          setSaving(false);
          return;
        } else {
          setError(`Employee already has the ${selectedCertificate.name} certificate assigned`);
          toast.error(`Employee already has the ${selectedCertificate.name} certificate assigned`);
          setSaving(false);
          return;
        }
      }

      // Validate dates
      if (newCertificateData.expiry_date && new Date(newCertificateData.issue_date) >= new Date(newCertificateData.expiry_date)) {
        setError('Expiry date must be after the issue date');
        setSaving(false);
        return;
      }

      await logSecurityEvent('certificate_assignment_attempt', {
        employee_id: employee.id,
        employee_name: employee.full_name,
        certificate_id: selectedCertificateId,
        certificate_name: selectedCertificate.name
      }, 'medium');

      // Insert the new certificate assignment first (we need the ID for file naming)
      console.log('[Certificate] Inserting certificate:', {
        business_id: selectedBusinessId,
        employee_id: employee.id,
        certificate_id: selectedCertificateId,
        issue_date: newCertificateData.issue_date
      });

      const { data, error: insertError } = await supabase
        .from('employee_certificates')
        .insert({
          business_id: selectedBusinessId,
          employee_id: employee.id,
          certificate_id: selectedCertificateId,
          issue_date: newCertificateData.issue_date,
          expiry_date: newCertificateData.expiry_date || null,
          certificate_number: newCertificateData.certificate_number || null,
          document_path: newCertificateData.document_path || null,
          notes: newCertificateData.notes || null,
          uploaded_by: authUser.id,
          status: 'active'
        })
        .select(`
          *,
          hr_certificates!inner(
            id,
            name,
            description,
            issuing_authority,
            requires_renewal,
            renewal_period_months
          )
        `)
        .single();

      if (insertError) {
        console.error('[Certificate] Insert error:', insertError);
        console.error('[Certificate] Insert error details:', JSON.stringify(insertError, null, 2));
        // Show more detailed error to user
        const errorMessage = insertError.message || insertError.details || 'Unknown error';
        throw new Error(`Failed to save certificate: ${errorMessage}. Code: ${insertError.code || 'unknown'}`);
      }

      console.log('[Certificate] Certificate inserted successfully:', data.id);

      // Upload file if one was selected (no PIN required for upload)
      if (selectedFile && data.id) {
        try {
          // Validate file type
          const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
          if (allowedTypes.includes(selectedFile.type) && selectedFile.size <= 10 * 1024 * 1024) {
            const fileExt = selectedFile.name.split('.').pop();
            const fileName = `${selectedBusinessId}/${employee.id}/${data.id}.${fileExt}`;
            
            const { data: uploadData, error: uploadError } = await supabase.storage
              .from('employee-certificates')
              .upload(fileName, selectedFile, {
                cacheControl: '3600',
                upsert: true
              });

            if (!uploadError) {
              // Store the file path (not public URL since bucket is private)
              console.log('[Certificate] Updating new certificate with file path:', fileName);
              
              const { error: updateError } = await supabase
                .from('employee_certificates')
                .update({ certificate_file_url: fileName })
                .eq('id', data.id);
              
              if (updateError) {
                console.error('[Certificate] Error updating new certificate file URL:', updateError);
              } else {
                console.log('[Certificate] New certificate file URL updated successfully');
              }
            }
          }
        } catch (fileError) {
          console.error('Error uploading file:', fileError);
          // Continue - certificate is saved, file upload is optional
        }
      }

      // Reset form FIRST
      setSelectedCertificateId('');
      setNewCertificateData({
        issue_date: '',
        expiry_date: '',
        certificate_number: '',
        document_path: '',
        notes: ''
      });
      setSelectedFile(null);
      setUploadingForCertificate(null);
      setShowAddForm(false);
      
      console.log('[Certificate] Reloading certificates list...');
      // Reload certificates to show the new one
      await loadCurrentCertificates();
      console.log('[Certificate] Certificates reloaded');
      
      setSuccess(`${selectedCertificate.name} certificate assigned successfully`);
      toast.success(`${selectedCertificate.name} certificate assigned successfully`);
      setSaving(false);

      // Record action for audit
      await recordAction('assign_employee_certificate', employee.id, true);

      // Notify parent component
      if (onCertificatesUpdated) {
        onCertificatesUpdated();
      }

    } catch (error) {
      console.error('Error assigning certificate:', error);
      const errorMsg = error.message || 'Unknown error occurred';
      setError(`Failed to assign certificate: ${errorMsg}`);
      toast.error(`Failed to assign certificate: ${errorMsg}`);
      await logSecurityEvent('certificate_assignment_failed', {
        employee_id: employee.id,
        certificate_id: selectedCertificateId,
        error_message: errorMsg,
        error_code: error.code
      }, 'high');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveCertificate = async (certificateAssignment) => {
    if (!confirm(`Remove ${certificateAssignment.hr_certificates.name} certificate from ${employee.full_name}?`)) {
      return;
    }

    // Rate limiting check
    const rateLimitCheck = await checkRateLimit('remove_certificate');
    if (!rateLimitCheck.allowed) {
      setError('Rate limit exceeded. Please wait before removing another certificate.');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      await logSecurityEvent('certificate_removal_attempt', {
        employee_id: employee.id,
        employee_name: employee.full_name,
        certificate_assignment_id: certificateAssignment.id,
        certificate_name: certificateAssignment.hr_certificates.name
      }, 'medium');

      // Soft delete by setting status to inactive
      const { error: updateError } = await supabase
        .from('employee_certificates')
        .update({ 
          status: 'inactive',
          updated_at: new Date().toISOString()
        })
        .eq('id', certificateAssignment.id);

      if (updateError) throw updateError;

      // Update local state
      setCurrentCertificates(prev => prev.filter(c => c.id !== certificateAssignment.id));
      setSuccess(`${certificateAssignment.hr_certificates.name} certificate removed successfully`);

      // Record action for audit
      await recordAction('remove_employee_certificate', employee.id, true);

      // Notify parent component
      if (onCertificatesUpdated) {
        onCertificatesUpdated();
      }

    } catch (error) {
      console.error('Error removing certificate:', error);
      setError('Failed to remove certificate: ' + error.message);
      await logSecurityEvent('certificate_removal_failed', {
        employee_id: employee.id,
        certificate_assignment_id: certificateAssignment.id,
        error_message: error.message
      }, 'high');
    } finally {
      setSaving(false);
    }
  };

  const handleChangeCertificateType = async (certificateAssignment, nextCertificateTypeId) => {
    if (!nextCertificateTypeId || nextCertificateTypeId === certificateAssignment.certificate_id) return;

    const nextType = availableCertificates.find((c) => c.id === nextCertificateTypeId);
    if (!nextType) {
      setError('Selected certificate type was not found.');
      return;
    }

    const alreadyHasType = currentCertificates.some(
      (c) => c.id !== certificateAssignment.id && c.certificate_id === nextCertificateTypeId
    );
    if (alreadyHasType) {
      setError(`This employee already has a ${nextType.name} certificate.`);
      return;
    }

    if (!confirm(`Change this certificate from "${certificateAssignment.hr_certificates?.name}" to "${nextType.name}"?\n\nThe uploaded file stays the same. Linked pending premiums may need review.`)) {
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const noteLine = `Reclassified to ${nextType.name} on ${new Date().toISOString().slice(0, 10)}.`;
      const nextNotes = certificateAssignment.notes
        ? `${certificateAssignment.notes}\n${noteLine}`
        : noteLine;

      const { error: updateError } = await supabase
        .from('employee_certificates')
        .update({
          certificate_id: nextCertificateTypeId,
          notes: nextNotes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', certificateAssignment.id)
        .eq('business_id', selectedBusinessId);

      if (updateError) throw updateError;

      await loadCurrentCertificates();
      setSuccess(`Certificate type updated to ${nextType.name}`);
      await recordAction('reclassify_employee_certificate', employee.id, true);
      await logSecurityEvent('certificate_type_changed', {
        employee_id: employee.id,
        certificate_assignment_id: certificateAssignment.id,
        from_certificate_id: certificateAssignment.certificate_id,
        to_certificate_id: nextCertificateTypeId,
      }, 'medium');

      if (onCertificatesUpdated) onCertificatesUpdated();
    } catch (err) {
      console.error('Error changing certificate type:', err);
      setError('Failed to change certificate type: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  // Get available certificates that aren't already assigned
  const getAvailableCertificates = () => {
    const assignedCertificateIds = currentCertificates.map(cc => cc.certificate_id);
    return availableCertificates.filter(c => !assignedCertificateIds.includes(c.id));
  };

  const getCertificateStatusColor = (cert) => {
    if (cert.is_expired) return TavariStyles.colors.danger;
    if (cert.expires_soon) return TavariStyles.colors.warning;
    return TavariStyles.colors.success;
  };

  const getCertificateStatusText = (cert) => {
    if (cert.is_expired) return `Expired ${Math.abs(cert.days_until_expiry)} days ago`;
    if (cert.expires_soon) return `Expires in ${cert.days_until_expiry} days`;
    if (cert.days_until_expiry) return `Valid for ${cert.days_until_expiry} days`;
    return 'Valid';
  };

  // Verify manager PIN
  const verifyManagerPIN = async () => {
    if (!pinInput || pinInput.length < 4) {
      setPinError('PIN must be at least 4 digits');
      return;
    }

    try {
      setPinError('');
      
      // Get all managers/owners/admins for this business
      const { data: userRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .eq('business_id', selectedBusinessId)
        .eq('active', true)
        .in('role', ['manager', 'owner', 'admin']);

      if (rolesError) throw rolesError;

      if (!userRoles || userRoles.length === 0) {
        setPinError('No managers found for this business');
        return;
      }

      const managerUserIds = userRoles.map(ur => ur.user_id);

      // Get PINs for all managers
      const { data: managers, error: managersError } = await supabase
        .from('users')
        .select('id, full_name, email, pin')
        .in('id', managerUserIds);

      if (managersError) throw managersError;

      // Check PIN against all managers
      let pinMatched = false;
      for (const manager of managers) {
        if (!manager.pin) continue;

        let matches = false;
        if (manager.pin.startsWith('$2b$') || manager.pin.startsWith('$2a$')) {
          // Bcrypt hashed PIN
          matches = await bcrypt.compare(pinInput, manager.pin);
        } else {
          // Plain text PIN
          matches = String(manager.pin) === String(pinInput);
        }

        if (matches) {
          pinMatched = true;
          await logSecurityEvent('certificate_pin_verified', {
            employee_id: employee.id,
            manager_id: manager.id,
            action: 'view'
          }, 'high');
          break;
        }
      }

      if (pinMatched) {
        setPinVerified(true);
        setShowPinModal(false);
        setPinInput('');
        
        if (viewingCertificate) {
          // Proceed with file view/download (PIN required)
          handleViewCertificate();
        }
      } else {
        setPinError('Invalid PIN. Please try again.');
        await logSecurityEvent('certificate_pin_failed', {
          employee_id: employee.id,
          attempted_by: authUser?.id
        }, 'high');
      }
    } catch (error) {
      console.error('Error verifying PIN:', error);
      setPinError('Failed to verify PIN: ' + error.message);
    }
  };

  // Handle file selection - no PIN required for upload
  const handleFileSelect = (certificateId) => {
    setUploadingForCertificate(certificateId);
    // Trigger file input directly - no PIN required for upload
    setTimeout(() => {
      document.getElementById('certificate-file-upload-existing')?.click();
    }, 100);
  };


  // Handle view/download certificate file
  const handleViewCertificate = async () => {
    if (!viewingCertificate) return;

    const cert = currentCertificates.find(c => c.id === viewingCertificate);
    if (!cert || !cert.certificate_file_url) {
      toast.error('No file available for this certificate');
      return;
    }

    try {
      // certificate_file_url contains the file path (e.g., "business_id/employee_id/certificate_id.pdf")
      // For private buckets, we need to create a signed URL using the path directly
      const filePath = cert.certificate_file_url;
      
      console.log('[Certificate] Creating signed URL for path:', filePath);
      
      const { data, error } = await supabase.storage
        .from('employee-certificates')
        .createSignedUrl(filePath, 3600); // 1 hour expiry

      if (error) {
        console.error('[Certificate] Error creating signed URL:', error);
        throw error;
      }

      console.log('[Certificate] Signed URL created successfully');

      // Open in new tab
      window.open(data.signedUrl, '_blank');

      await logSecurityEvent('certificate_file_viewed', {
        employee_id: employee.id,
        certificate_id: viewingCertificate
      }, 'medium');

    } catch (error) {
      console.error('Error viewing file:', error);
      toast.error('Failed to open file: ' + error.message);
    } finally {
      setViewingCertificate(null);
      setPinVerified(false);
    }
  };

  // Trigger PIN modal for viewing
  const handleViewFile = (certificateId) => {
    setViewingCertificate(certificateId);
    setPinVerified(false);
    setShowPinModal(true);
    setPinInput('');
    setPinError('');
  };

  const styles = {
    overlay: {
      ...TavariStyles.components.modal?.overlay,
      display: isOpen ? 'flex' : 'none'
    },
    modal: {
      ...TavariStyles.components.modal?.content,
      width: '700px',
      maxHeight: '85vh'
    },
    header: {
      ...TavariStyles.components.modal?.header,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    title: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    closeButton: {
      background: 'none',
      border: 'none',
      color: TavariStyles.colors.gray500,
      cursor: 'pointer',
      padding: TavariStyles.spacing.sm
    },
    body: {
      ...TavariStyles.components.modal?.body,
      maxHeight: '500px',
      overflowY: 'auto'
    },
    employeeInfo: {
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      marginBottom: TavariStyles.spacing.xl,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    employeeName: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xs
    },
    employeeDetails: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    section: {
      marginBottom: TavariStyles.spacing.xl
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.lg,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    toggleButton: {
      ...TavariStyles.components.button?.base,
      ...TavariStyles.components.button?.variants?.secondary,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      marginBottom: TavariStyles.spacing.lg
    },
    addForm: {
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      marginBottom: TavariStyles.spacing.lg
    },
    formRow: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.lg
    },
    formGroup: {
      display: 'flex',
      flexDirection: 'column'
    },
    formGroupFull: {
      display: 'flex',
      flexDirection: 'column',
      gridColumn: '1 / -1'
    },
    label: {
      ...TavariStyles.components.form?.label,
      marginBottom: TavariStyles.spacing.sm
    },
    select: {
      ...TavariStyles.components.form?.select,
      width: '90%'
    },
    input: {
      ...TavariStyles.components.form?.input,
      width: '90%'
    },
    textarea: {
      ...TavariStyles.components.form?.input,
      width: '90%',
      minHeight: '80px',
      resize: 'vertical'
    },
    formActions: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      justifyContent: 'flex-end'
    },
    addButton: {
      ...TavariStyles.components.button?.base,
      ...TavariStyles.components.button?.variants?.primary,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs
    },
    cancelButton: {
      ...TavariStyles.components.button?.base,
      ...TavariStyles.components.button?.variants?.secondary,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs
    },
    certificatesList: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.md
    },
    certificateItem: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)'
    },
    certificateInfo: {
      flex: 1
    },
    certificateName: {
      fontSize: TavariStyles.typography.fontSize.md,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xs
    },
    certificateDetails: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.sm
    },
    certificateStatus: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      padding: '4px 8px',
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      display: 'inline-block'
    },
    certificateActions: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm,
      alignItems: 'flex-end'
    },
    removeButton: {
      ...TavariStyles.components.button?.base,
      backgroundColor: TavariStyles.colors.errorBg,
      color: TavariStyles.colors.danger,
      border: `1px solid ${TavariStyles.colors.danger}50`,
      padding: TavariStyles.spacing.sm,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs
    },
    emptyState: {
      textAlign: 'center',
      padding: TavariStyles.spacing['3xl'],
      color: TavariStyles.colors.gray500
    },
    emptyIcon: {
      color: TavariStyles.colors.gray400,
      marginBottom: TavariStyles.spacing.lg
    },
    emptyText: {
      fontSize: TavariStyles.typography.fontSize.lg
    },
    message: {
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      marginBottom: TavariStyles.spacing.lg,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    errorMessage: {
      backgroundColor: TavariStyles.colors.errorBg,
      color: TavariStyles.colors.danger,
      border: `1px solid ${TavariStyles.colors.danger}30`
    },
    successMessage: {
      backgroundColor: TavariStyles.colors.successBg,
      color: TavariStyles.colors.success,
      border: `1px solid ${TavariStyles.colors.success}30`
    },
    loading: {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      padding: TavariStyles.spacing['3xl'],
      color: TavariStyles.colors.gray600
    }
  };

  if (!isOpen) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3 style={styles.title}>
            <Award size={24} />
            Manage Certificate Assignments
          </h3>
          <button onClick={onClose} style={styles.closeButton}>
            <X size={24} />
          </button>
        </div>

        <div style={styles.body}>
          {/* Employee Info */}
          <div style={styles.employeeInfo}>
            <div style={styles.employeeName}>{employee?.full_name}</div>
            <div style={styles.employeeDetails}>
              <PositionLabel businessId={selectedBusinessId} value={employee?.position} emptyFallback="" />
              {employee?.department && ` • ${employee.department}`}
              {employee?.employee_number != null && employee?.employee_number !== '' && ` • Employee #${employee.employee_number}`}
            </div>
          </div>

          {/* Messages */}
          {error && (
            <div style={{...styles.message, ...styles.errorMessage}}>
              <AlertTriangle size={20} />
              {error}
            </div>
          )}

          {success && (
            <div style={{...styles.message, ...styles.successMessage}}>
              <Check size={20} />
              {success}
            </div>
          )}

          {/* Add New Certificate */}
          <div style={styles.section}>
            <h4 style={styles.sectionTitle}>
              <Plus size={20} />
              Assign New Certificate
            </h4>
            
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              style={styles.toggleButton}
              disabled={saving}
            >
              <Plus size={16} />
              {showAddForm ? 'Cancel' : 'Add Certificate'}
            </button>

            {showAddForm && (
              <div style={styles.addForm}>
                <div style={styles.formRow}>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Certificate Type *</label>
                    <select
                      value={selectedCertificateId}
                      onChange={(e) => setSelectedCertificateId(e.target.value)}
                      style={styles.select}
                      disabled={saving}
                    >
                      <option value="">Choose a certificate...</option>
                      {getAvailableCertificates().map(cert => (
                        <option key={cert.id} value={cert.id}>
                          {cert.name} - {cert.issuing_authority}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Certificate Number</label>
                    <input
                      type="text"
                      value={newCertificateData.certificate_number}
                      onChange={(e) => setNewCertificateData(prev => ({
                        ...prev,
                        certificate_number: e.target.value
                      }))}
                      style={styles.input}
                      placeholder="Enter certificate number"
                      disabled={saving}
                    />
                  </div>
                </div>

                <div style={styles.formRow}>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Issue Date *</label>
                    <input
                      type="date"
                      value={newCertificateData.issue_date}
                      onChange={(e) => setNewCertificateData(prev => ({
                        ...prev,
                        issue_date: e.target.value
                      }))}
                      style={styles.input}
                      disabled={saving}
                    />
                  </div>
                  
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Expiry Date</label>
                    <input
                      type="date"
                      value={newCertificateData.expiry_date}
                      onChange={(e) => setNewCertificateData(prev => ({
                        ...prev,
                        expiry_date: e.target.value
                      }))}
                      style={styles.input}
                      disabled={saving}
                    />
                  </div>
                </div>

                <div style={styles.formGroupFull}>
                  <label style={styles.label}>Notes</label>
                  <textarea
                    value={newCertificateData.notes}
                    onChange={(e) => setNewCertificateData(prev => ({
                      ...prev,
                      notes: e.target.value
                    }))}
                    style={styles.textarea}
                    placeholder="Additional notes about this certificate..."
                    disabled={saving}
                  />
                </div>

                <div style={styles.formGroupFull}>
                  <label style={styles.label}>Certificate Document (PDF/Image)</label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          setSelectedFile(e.target.files[0]);
                        }
                      }}
                      style={{ display: 'none' }}
                      id="certificate-file-input"
                      disabled={saving}
                    />
                    <label
                      htmlFor="certificate-file-input"
                      style={{
                        ...styles.secondaryButton,
                        cursor: saving ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px 16px'
                      }}
                    >
                      <Upload size={16} />
                      {selectedFile ? selectedFile.name : 'Select File'}
                    </label>
                    {selectedFile && (
                      <button
                        type="button"
                        onClick={() => setSelectedFile(null)}
                        style={{
                          ...styles.cancelButton,
                          padding: '8px 16px'
                        }}
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                  <span style={styles.description}>
                    Upload certificate document (PDF, JPG, PNG - Max 10MB). Manager PIN required.
                  </span>
                </div>

                <div style={styles.formActions}>
                  <button
                    onClick={() => {
                      setShowAddForm(false);
                      setSelectedCertificateId('');
                      setNewCertificateData({
                        issue_date: '',
                        expiry_date: '',
                        certificate_number: '',
                        document_path: '',
                        notes: ''
                      });
                    }}
                    style={styles.cancelButton}
                    disabled={saving}
                  >
                    <X size={16} />
                    Cancel
                  </button>
                  
                  <button
                    onClick={async () => {
                      // No PIN required - just save the certificate
                      await handleAddCertificate();
                    }}
                    disabled={!selectedCertificateId || !newCertificateData.issue_date || saving || uploadingFile}
                    style={{
                      ...styles.addButton,
                      opacity: (!selectedCertificateId || !newCertificateData.issue_date || saving || uploadingFile) ? 0.6 : 1,
                      cursor: (!selectedCertificateId || !newCertificateData.issue_date || saving || uploadingFile) ? 'not-allowed' : 'pointer'
                    }}
                  >
                    <Check size={16} />
                    {saving || uploadingFile ? 'Processing...' : 'Add Certificate'}
                  </button>
                </div>
              </div>
            )}

            {!showAddForm && getAvailableCertificates().length === 0 && (
              <div style={styles.emptyState}>
                <div style={styles.emptyText}>
                  All available certificates have been assigned to this employee.
                </div>
              </div>
            )}
          </div>

          {/* Current Certificates */}
          <div style={styles.section}>
            <h4 style={styles.sectionTitle}>
              <Award size={20} />
              Current Certificate Assignments ({currentCertificates.length})
            </h4>

            {loading ? (
              <div style={styles.loading}>Loading current certificates...</div>
            ) : currentCertificates.length === 0 ? (
              <div style={styles.emptyState}>
                <Award size={48} style={styles.emptyIcon} />
                <div style={styles.emptyText}>
                  No certificates currently assigned to this employee.
                </div>
              </div>
            ) : (
              <div style={styles.certificatesList}>
                {currentCertificates.map((cert) => (
                  <div key={cert.id} style={styles.certificateItem}>
                    <div style={styles.certificateInfo}>
                      <div style={styles.certificateName}>
                        {cert.hr_certificates.name}
                      </div>
                      
                      <div style={styles.certificateDetails}>
                        <strong>Certificate type:</strong>{' '}
                        <select
                          value={cert.certificate_id}
                          disabled={saving}
                          onChange={(e) => handleChangeCertificateType(cert, e.target.value)}
                          style={{
                            marginLeft: '4px',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            border: `1px solid ${TavariStyles.colors.gray300}`,
                            maxWidth: '240px',
                          }}
                          title="Change certificate type if the employee uploaded under the wrong category"
                        >
                          {availableCertificates.map((type) => (
                            <option key={type.id} value={type.id}>
                              {type.name}
                            </option>
                          ))}
                        </select>
                        <br />
                        <strong>Issuing Authority:</strong> {cert.hr_certificates.issuing_authority}
                        <br />
                        <strong>Issue Date:</strong> {new Date(cert.issue_date).toLocaleDateString()}
                        {cert.expiry_date && (
                          <>
                            <br />
                            <strong>Expiry Date:</strong> {new Date(cert.expiry_date).toLocaleDateString()}
                          </>
                        )}
                        {cert.certificate_number && (
                          <>
                            <br />
                            <strong>Certificate #:</strong> {cert.certificate_number}
                          </>
                        )}
                        {cert.notes && (
                          <>
                            <br />
                            <strong>Notes:</strong> {cert.notes}
                          </>
                        )}
                      </div>
                      
                      <div 
                        style={{
                          ...styles.certificateStatus,
                          backgroundColor: `${getCertificateStatusColor(cert)}20`,
                          color: getCertificateStatusColor(cert),
                          border: `1px solid ${getCertificateStatusColor(cert)}40`
                        }}
                      >
                        {getCertificateStatusText(cert)}
                      </div>
                    </div>
                    
                    <div style={styles.certificateActions}>
                      {cert.certificate_file_url ? (
                        <button
                          onClick={() => handleViewFile(cert.id)}
                          disabled={saving}
                          style={{
                            ...styles.secondaryButton,
                            opacity: saving ? 0.6 : 1,
                            cursor: saving ? 'not-allowed' : 'pointer',
                            marginRight: '8px'
                          }}
                          title="Download certificate file (Manager PIN required)"
                        >
                          <Download size={16} />
                          Download
                        </button>
                      ) : (
                        <button
                          onClick={() => handleFileSelect(cert.id)}
                          disabled={saving || uploadingFile}
                          style={{
                            ...styles.secondaryButton,
                            opacity: (saving || uploadingFile) ? 0.6 : 1,
                            cursor: (saving || uploadingFile) ? 'not-allowed' : 'pointer',
                            marginRight: '8px'
                          }}
                          title="Upload certificate file"
                        >
                          <Upload size={16} />
                          Upload File
                        </button>
                      )}
                      <button
                        onClick={() => handleRemoveCertificate(cert)}
                        disabled={saving}
                        style={{
                          ...styles.removeButton,
                          opacity: saving ? 0.6 : 1,
                          cursor: saving ? 'not-allowed' : 'pointer'
                        }}
                        title="Remove certificate"
                      >
                        <Trash2 size={16} />
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* PIN Verification Modal */}
      {showPinModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }}>
          <div style={{
            backgroundColor: TavariStyles.colors.white,
            padding: TavariStyles.spacing.xl,
            borderRadius: TavariStyles.borderRadius?.lg || '12px',
            maxWidth: '400px',
            width: '90%',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.2)'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: TavariStyles.spacing.lg
            }}>
              <Lock size={24} color={TavariStyles.colors.primary} />
              <h3 style={{ margin: 0 }}>Manager PIN Required</h3>
            </div>
            
            <p style={{
              color: TavariStyles.colors.gray600,
              marginBottom: TavariStyles.spacing.md
            }}>
              {uploadingForCertificate === 'new' 
                ? 'Enter your manager PIN to upload the certificate file.'
                : uploadingForCertificate
                ? 'Enter your manager PIN to upload a file for this certificate.'
                : 'Enter your manager PIN to download the certificate file.'}
            </p>

            <input
              type="password"
              value={pinInput}
              onChange={(e) => {
                setPinInput(e.target.value);
                setPinError('');
              }}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && pinInput.length >= 4) {
                  verifyManagerPIN();
                }
              }}
              placeholder="Enter 4-digit PIN"
              maxLength={10}
              style={{
                width: '90%',
                padding: '12px 16px',
                border: `2px solid ${pinError ? TavariStyles.colors.danger : TavariStyles.colors.gray300}`,
                borderRadius: TavariStyles.borderRadius?.md || '6px',
                fontSize: '14px',
                textAlign: 'center',
                letterSpacing: '4px',
                fontFamily: 'monospace',
                marginBottom: TavariStyles.spacing.sm
              }}
              autoFocus
            />

            {pinError && (
              <div style={{
                color: TavariStyles.colors.danger,
                fontSize: '11px',
                marginBottom: TavariStyles.spacing.md
              }}>
                {pinError}
              </div>
            )}

            <div style={{
              display: 'flex',
              gap: TavariStyles.spacing.md,
              justifyContent: 'flex-end'
            }}>
              <button
                onClick={() => {
                  setShowPinModal(false);
                  setPinInput('');
                  setPinError('');
                  setUploadingForCertificate(null);
                  setViewingCertificate(null);
                  setPinVerified(false);
                }}
                style={styles.cancelButton}
              >
                Cancel
              </button>
              <button
                onClick={verifyManagerPIN}
                disabled={pinInput.length < 4}
                style={{
                  ...styles.addButton,
                  opacity: pinInput.length < 4 ? 0.6 : 1,
                  cursor: pinInput.length < 4 ? 'not-allowed' : 'pointer'
                }}
              >
                Verify PIN
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input for existing certificates */}
      <input
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={async (e) => {
          if (e.target.files && e.target.files[0] && uploadingForCertificate && uploadingForCertificate !== 'new') {
            const file = e.target.files[0];
            setSelectedFile(file);
            
            // Validate file
            const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
            if (!allowedTypes.includes(file.type)) {
              toast.error('Invalid file type. Please upload PDF or image files only.');
              return;
            }

            if (file.size > 10 * 1024 * 1024) {
              toast.error('File size exceeds 10MB limit');
              return;
            }

            // Upload file
            try {
              setUploadingFile(true);
              
              const fileExt = file.name.split('.').pop();
              const fileName = `${selectedBusinessId}/${employee.id}/${uploadingForCertificate}.${fileExt}`;

              console.log('[Certificate] Uploading file:', fileName);

              const { data: uploadData, error: uploadError } = await supabase.storage
                .from('employee-certificates')
                .upload(fileName, file, {
                  cacheControl: '3600',
                  upsert: true
                });

              if (uploadError) {
                console.error('[Certificate] Upload error:', uploadError);
                throw uploadError;
              }

              console.log('[Certificate] File uploaded successfully:', uploadData);

              // Store the file path (not public URL since bucket is private)
              // We'll generate signed URLs when viewing/downloading
              const filePath = fileName; // Store the path, not a public URL
              
              console.log('[Certificate] Updating database with file path:', filePath);
              console.log('[Certificate] Certificate ID:', uploadingForCertificate);

              const { data: updateData, error: updateError } = await supabase
                .from('employee_certificates')
                .update({ certificate_file_url: filePath })
                .eq('id', uploadingForCertificate)
                .select();

              if (updateError) {
                console.error('[Certificate] Database update error:', updateError);
                console.error('[Certificate] Update error details:', JSON.stringify(updateError, null, 2));
                throw updateError;
              }

              console.log('[Certificate] Database updated successfully:', updateData);

              await loadCurrentCertificates();
              toast.success('Certificate file uploaded successfully');
              
              setSelectedFile(null);
              setUploadingForCertificate(null);

              await logSecurityEvent('certificate_file_uploaded', {
                employee_id: employee.id,
                certificate_id: uploadingForCertificate,
                file_name: fileName
              }, 'high');

            } catch (error) {
              console.error('Error uploading file:', error);
              toast.error('Failed to upload file: ' + error.message);
            } finally {
              setUploadingFile(false);
            }
          }
        }}
        style={{ display: 'none' }}
        id="certificate-file-upload-existing"
      />
    </div>
  );
};

export default EmployeeCertificateManagementModal;