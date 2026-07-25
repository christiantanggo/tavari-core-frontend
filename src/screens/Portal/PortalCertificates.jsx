// PortalCertificates.jsx - Employee Portal Certificate Management
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { Upload, Download, Eye, FileText, Calendar, AlertCircle, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { getPublicUserId } from '../../utils/getPublicUserId';
import { getEmployeePortalSelectedBusinessId } from '../../utils/employeeProfileSelection';
import DateDropdownInput, { getLocalIsoDate } from '../../components/UI/DateDropdownInput';

const PortalCertificates = () => {
  const navigate = useNavigate();
  const [publicUserId, setPublicUserId] = useState(null);
  const [businessId, setBusinessId] = useState(null);
  const [certificates, setCertificates] = useState([]);
  const [requiredCertificates, setRequiredCertificates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadingForCertificate, setUploadingForCertificate] = useState(null);
  const [showCertificateForm, setShowCertificateForm] = useState(false);
  const [certificateFormData, setCertificateFormData] = useState({
    issue_date: '',
    expiry_date: '',
    certificate_number: ''
  });
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadData();
    window.addEventListener('employee-profile-selection-changed', loadData);
    return () => window.removeEventListener('employee-profile-selection-changed', loadData);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Get current user
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        navigate('/portal/login');
        return;
      }

      // Get public user ID
      const userId = await getPublicUserId(currentUser.email);
      if (!userId) {
        toast.error('User profile not found');
        return;
      }

      setPublicUserId(userId);

      // Get business ID
      const { data: businessUsers } = await supabase
        .from('business_users')
        .select('business_id')
        .eq('user_id', userId)
        .limit(20);

      if (!businessUsers || businessUsers.length === 0) {
        toast.error('You are not associated with any business');
        return;
      }

      const selectedBusinessId = getEmployeePortalSelectedBusinessId();
      const userBusinessId = businessUsers.find((row) => row.business_id === selectedBusinessId)?.business_id || businessUsers[0].business_id;
      setBusinessId(userBusinessId);

      // Load employee's existing certificates
      await loadCertificates(userId, userBusinessId);

      // Load certificates required by shift premiums
      await loadRequiredCertificates(userId, userBusinessId);

    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Error loading certificates');
    } finally {
      setLoading(false);
    }
  };

  const loadCertificates = async (userId, businessId) => {
    try {
      const { data, error } = await supabase
        .from('employee_certificates')
        .select(`
          id,
          employee_id,
          certificate_id,
          business_id,
          issue_date,
          expiry_date,
          certificate_number,
          status,
          notes,
          created_at,
          updated_at,
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
        .eq('business_id', businessId)
        .eq('employee_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Transform data to include expiry calculations
      const transformedCerts = (data || []).map(cert => ({
        ...cert,
        is_expired: cert.expiry_date ? new Date(cert.expiry_date) < new Date() : false,
        days_until_expiry: cert.expiry_date ? Math.ceil((new Date(cert.expiry_date) - new Date()) / (1000 * 60 * 60 * 24)) : null,
        expires_soon: cert.expiry_date ? Math.ceil((new Date(cert.expiry_date) - new Date()) / (1000 * 60 * 60 * 24)) <= 30 : false
      }));

      setCertificates(transformedCerts);
    } catch (error) {
      console.error('Error loading certificates:', error);
      toast.error('Failed to load certificates');
    }
  };

  const loadRequiredCertificates = async (userId, businessId) => {
    try {
      console.log('[PortalCertificates] Loading required certificates for user:', userId, 'business:', businessId);
      
      // Get ALL shift premiums that require certificates (for this business)
      // Show ALL premiums with certificate requirements, not just assigned ones
      // This allows employees to upload certificates for premiums they might need
      const { data: allShiftPremiums, error: allPremiumsError } = await supabase
        .from('hr_shift_premiums')
        .select(`
          id,
          name,
          requires_certificate,
          required_certificate_id,
          is_active
        `)
        .eq('business_id', businessId)
        .eq('is_active', true)
        .eq('requires_certificate', true)
        .not('required_certificate_id', 'is', null);

      console.log('[PortalCertificates] All shift premiums with certificate requirements:', allShiftPremiums);

      if (allPremiumsError) {
        console.error('[PortalCertificates] Error loading shift premiums:', allPremiumsError);
        setRequiredCertificates([]);
        return;
      }

      if (!allShiftPremiums || allShiftPremiums.length === 0) {
        console.log('[PortalCertificates] No shift premiums with certificate requirements found');
        setRequiredCertificates([]);
        return;
      }

      // Get certificate details for all required certificates
      const certificateIds = allShiftPremiums
        .map(sp => sp.required_certificate_id)
        .filter(Boolean);

      if (certificateIds.length === 0) {
        console.log('[PortalCertificates] No certificate IDs found');
        setRequiredCertificates([]);
        return;
      }

      const { data: certificates, error: certsError } = await supabase
        .from('hr_certificates')
        .select('id, name, description, issuing_authority, requires_renewal, renewal_period_months')
        .in('id', certificateIds)
        .eq('is_active', true);

      console.log('[PortalCertificates] Certificate details:', certificates);

      if (certsError) {
        console.error('[PortalCertificates] Error loading certificates:', certsError);
        setRequiredCertificates([]);
        return;
      }

      // Transform to certificate list with premium info
      // Show ALL premiums with certificate requirements
      const requiredCerts = allShiftPremiums
        .map(sp => {
          const cert = certificates?.find(c => c.id === sp.required_certificate_id);
          if (!cert) {
            console.warn('[PortalCertificates] Certificate not found for premium:', sp.name, 'certificate_id:', sp.required_certificate_id);
            return null;
          }
          
          return {
            certificate_id: sp.required_certificate_id,
            certificate: cert,
            premium_name: sp.name,
            premium_id: sp.id
          };
        })
        .filter(Boolean);

      console.log('[PortalCertificates] Final required certificates:', requiredCerts);
      setRequiredCertificates(requiredCerts);
    } catch (error) {
      console.error('[PortalCertificates] Error loading required certificates:', error);
      setRequiredCertificates([]);
    }
  };

  const handleFileSelect = (certificateId, isRequiredCert = false) => {
    // Prefix required certificates with 'cert_' to distinguish from existing employee_certificates.id
    setUploadingForCertificate(isRequiredCert ? `cert_${certificateId}` : certificateId);
    
    // If this is an existing certificate, pre-fill form with current data
    if (!isRequiredCert) {
      const existingCert = certificates.find(c => c.id === certificateId);
      if (existingCert) {
        setCertificateFormData({
          issue_date: existingCert.issue_date || '',
          expiry_date: existingCert.expiry_date || '',
          certificate_number: existingCert.certificate_number || ''
        });
      } else {
        setCertificateFormData({
          issue_date: '',
          expiry_date: '',
          certificate_number: ''
        });
      }
    } else {
      // For required certificates, check if employee already has it
      const reqCert = requiredCertificates.find(rc => rc.certificate_id === certificateId);
      if (reqCert) {
        const existingCert = certificates.find(c => c.certificate_id === reqCert.certificate_id);
        if (existingCert) {
          setCertificateFormData({
            issue_date: existingCert.issue_date || '',
            expiry_date: existingCert.expiry_date || '',
            certificate_number: existingCert.certificate_number || ''
          });
        } else {
          setCertificateFormData({
            issue_date: '',
            expiry_date: '',
            certificate_number: ''
          });
        }
      } else {
        setCertificateFormData({
          issue_date: '',
          expiry_date: '',
          certificate_number: ''
        });
      }
    }
    
    setSelectedFile(null);
    setShowCertificateForm(true);
    // Trigger file input
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e) => {
    if (!e.target.files || !e.target.files[0]) return;

    const file = e.target.files[0];
    
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

    // Store the file for later upload
    setSelectedFile(file);
  };

  const handleFormSubmit = async () => {
    if (!selectedFile || !uploadingForCertificate) {
      toast.error('Please select a file first');
      return;
    }

    // Validate form data
    if (!certificateFormData.issue_date) {
      toast.error('Issue date is required');
      return;
    }

    // Validate dates
    if (certificateFormData.expiry_date && new Date(certificateFormData.issue_date) >= new Date(certificateFormData.expiry_date)) {
      toast.error('Expiry date must be after the issue date');
      return;
    }

    // Close form and proceed with upload
    setShowCertificateForm(false);
    await handleFileUpload(selectedFile);
  };

  const handleFileUpload = async (file) => {
    if (!file || !uploadingForCertificate) return;

    try {
      setUploading(true);
      
      const fileExt = file.name.split('.').pop();
      
      // Check if this is a required certificate (certificate_id) or existing certificate (id)
      const isRequiredCert = typeof uploadingForCertificate === 'string' && uploadingForCertificate.startsWith('cert_');
      const certificateId = isRequiredCert ? uploadingForCertificate.replace('cert_', '') : null;
      const existingCertId = !isRequiredCert ? uploadingForCertificate : null;

      let employeeCertId = existingCertId;

      // If this is a required certificate, create or find employee_certificates entry
      if (isRequiredCert && certificateId) {
        // Check if employee_certificates entry already exists
        const { data: existingCert, error: checkError } = await supabase
          .from('employee_certificates')
          .select('id')
          .eq('business_id', businessId)
          .eq('employee_id', publicUserId)
          .eq('certificate_id', certificateId)
          .eq('status', 'active')
          .maybeSingle();

        if (checkError && checkError.code !== 'PGRST116') {
          throw checkError;
        }

        if (existingCert) {
          employeeCertId = existingCert.id;
          // Update existing certificate with new form data
          const { error: updateError } = await supabase
            .from('employee_certificates')
            .update({
              issue_date: certificateFormData.issue_date,
              expiry_date: certificateFormData.expiry_date || null,
              certificate_number: certificateFormData.certificate_number || null
            })
            .eq('id', existingCert.id);

          if (updateError) {
            throw updateError;
          }
        } else {
          // Create new employee_certificates entry with form data
          const { data: newCert, error: createError } = await supabase
            .from('employee_certificates')
            .insert({
              business_id: businessId,
              employee_id: publicUserId,
              certificate_id: certificateId,
              issue_date: certificateFormData.issue_date,
              expiry_date: certificateFormData.expiry_date || null,
              certificate_number: certificateFormData.certificate_number || null,
              status: 'active'
            })
            .select()
            .single();

          if (createError) {
            throw createError;
          }

          employeeCertId = newCert.id;
        }
      } else if (existingCertId) {
        // Update existing certificate with new form data
        const { error: updateError } = await supabase
          .from('employee_certificates')
          .update({
            issue_date: certificateFormData.issue_date,
            expiry_date: certificateFormData.expiry_date || null,
            certificate_number: certificateFormData.certificate_number || null
          })
          .eq('id', existingCertId);

        if (updateError) {
          throw updateError;
        }
      }

      if (!employeeCertId) {
        throw new Error('Could not create or find certificate entry');
      }

      const fileName = `${businessId}/${publicUserId}/${employeeCertId}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('employee-certificates')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) {
        throw uploadError;
      }

      // Update database with file path
      const { error: updateError } = await supabase
        .from('employee_certificates')
        .update({ certificate_file_url: fileName })
        .eq('id', employeeCertId);

      if (updateError) {
        throw updateError;
      }

      toast.success('Certificate file uploaded successfully');

      try {
        const { data: premiumResult, error: premiumFnError } = await supabase.functions.invoke(
          'certificate-premium-on-upload',
          {
            body: {
              business_id: businessId,
              employee_certificate_id: employeeCertId,
            },
          }
        );

        if (premiumFnError) {
          console.warn('[PortalCertificates] Shift premium auto-assign:', premiumFnError);
        } else if (premiumResult?.assigned?.some((row) => row.assignment_id)) {
          toast.success('Shift premium submitted for manager approval');
        }
      } catch (premiumErr) {
        console.warn('[PortalCertificates] Shift premium auto-assign failed:', premiumErr);
      }

      await loadCertificates(publicUserId, businessId);
      await loadRequiredCertificates(publicUserId, businessId);
      setUploadingForCertificate(null);
      setSelectedFile(null);
      setCertificateFormData({
        issue_date: '',
        expiry_date: '',
        certificate_number: ''
      });
      
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      toast.error('Failed to upload file: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  const handleViewCertificate = async (certificateId) => {
    const cert = certificates.find(c => c.id === certificateId);
    if (!cert || !cert.certificate_file_url) {
      toast.error('No file available for this certificate');
      return;
    }

    try {
      const filePath = cert.certificate_file_url;
      
      // Create signed URL for viewing (valid for 1 hour)
      const { data, error } = await supabase.storage
        .from('employee-certificates')
        .createSignedUrl(filePath, 3600);

      if (error) throw error;

      // Open in new tab
      window.open(data.signedUrl, '_blank');
    } catch (error) {
      console.error('Error viewing certificate:', error);
      toast.error('Failed to view certificate: ' + error.message);
    }
  };

  const handleDownloadCertificate = async (certificateId) => {
    const cert = certificates.find(c => c.id === certificateId);
    if (!cert || !cert.certificate_file_url) {
      toast.error('No file available for this certificate');
      return;
    }

    try {
      const filePath = cert.certificate_file_url;
      
      // Create signed URL for download (valid for 1 hour)
      const { data, error } = await supabase.storage
        .from('employee-certificates')
        .createSignedUrl(filePath, 3600);

      if (error) throw error;

      // Download file
      const response = await fetch(data.signedUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${cert.hr_certificates?.name || 'certificate'}_${cert.id}.${filePath.split('.').pop()}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      toast.success('Certificate downloaded successfully');
    } catch (error) {
      console.error('Error downloading certificate:', error);
      toast.error('Failed to download certificate: ' + error.message);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-CA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const styles = {
    container: {
      maxWidth: '1200px',
      width: '100%',
      minWidth: 0,
      margin: '0 auto',
      padding: TavariStyles.spacing.xl,
      overflowX: 'hidden',
      boxSizing: 'border-box'
    },
    header: {
      marginBottom: TavariStyles.spacing.xl
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.sm
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray600
    },
    card: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing.xl,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
      minWidth: 0,
      boxSizing: 'border-box',
      overflowWrap: 'anywhere'
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      paddingBottom: TavariStyles.spacing.sm
    },
    certificateList: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.md,
      minWidth: 0
    },
    certificateCard: {
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      padding: TavariStyles.spacing.lg,
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.md,
      minWidth: 0,
      boxSizing: 'border-box',
      overflowWrap: 'anywhere'
    },
    certificateHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: TavariStyles.spacing.md,
      flexWrap: 'wrap',
      minWidth: 0
    },
    certificateInfo: {
      flex: '1 1 220px',
      minWidth: 0
    },
    certificateName: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.xs
    },
    certificateMeta: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    statusBadge: {
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      display: 'inline-flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      maxWidth: '100%',
      boxSizing: 'border-box',
      overflowWrap: 'anywhere'
    },
    statusExpired: {
      backgroundColor: '#fee2e2',
      color: '#991b1b'
    },
    statusExpiresSoon: {
      backgroundColor: '#fef3c7',
      color: '#92400e'
    },
    statusValid: {
      backgroundColor: '#d1fae5',
      color: '#065f46'
    },
    certificateActions: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      flexWrap: 'wrap'
    },
    button: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: 'none',
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      transition: 'all 0.2s'
    },
    uploadButton: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white
    },
    viewButton: {
      backgroundColor: TavariStyles.colors.gray100,
      color: TavariStyles.colors.gray700
    },
    downloadButton: {
      backgroundColor: TavariStyles.colors.gray100,
      color: TavariStyles.colors.gray700
    },
    emptyState: {
      textAlign: 'center',
      padding: TavariStyles.spacing['3xl'],
      color: TavariStyles.colors.gray600
    },
    loading: {
      textAlign: 'center',
      padding: TavariStyles.spacing['3xl'],
      color: TavariStyles.colors.gray600
    }
  };

  if (loading) {
    return (
      <div style={styles.loading}>Loading certificates...</div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>My Certificates</h1>
        <p style={styles.subtitle}>View and upload your certificates. Managers can view these certificates in your employee profile.</p>
      </div>

      {/* Required Certificates (from Shift Premiums) */}
      {requiredCertificates.length > 0 && (
        <div style={styles.card}>
          <h2 style={{ ...styles.sectionTitle, marginBottom: TavariStyles.spacing.lg }}>
            Required Certificates
          </h2>
          <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, marginBottom: TavariStyles.spacing.md }}>
            These certificates are required for shift premiums you have been assigned. Upload your certificate files here.
          </p>
          <div style={styles.certificateList}>
            {requiredCertificates.map((reqCert) => {
              // Check if employee already has this certificate uploaded
              const existingCert = certificates.find(c => c.certificate_id === reqCert.certificate_id);
              
              return (
                <div key={`req_${reqCert.certificate_id}`} style={styles.certificateCard}>
                  <div style={styles.certificateHeader}>
                    <div style={styles.certificateInfo}>
                      <div style={styles.certificateName}>
                        {reqCert.certificate.name}
                        <span style={{ 
                          fontSize: TavariStyles.typography.fontSize.sm, 
                          color: TavariStyles.colors.gray600,
                          marginLeft: TavariStyles.spacing.sm,
                          fontWeight: 'normal'
                        }}>
                          (Required for: {reqCert.premium_name})
                        </span>
                      </div>
                      <div style={styles.certificateMeta}>
                        {reqCert.certificate.issuing_authority && (
                          <div>Issuing Authority: {reqCert.certificate.issuing_authority}</div>
                        )}
                        {reqCert.certificate.description && (
                          <div>{reqCert.certificate.description}</div>
                        )}
                        {existingCert && (
                          <>
                            {existingCert.issue_date && (
                              <div>Issue Date: {formatDate(existingCert.issue_date)}</div>
                            )}
                            {existingCert.expiry_date && (
                              <div>Expiry Date: {formatDate(existingCert.expiry_date)}</div>
                            )}
                            {existingCert.expiry_date && existingCert.days_until_expiry !== null && (
                              <div>
                                {existingCert.is_expired ? (
                                  <span style={{ ...styles.statusBadge, ...styles.statusExpired }}>
                                    <AlertCircle size={14} />
                                    Expired {Math.abs(existingCert.days_until_expiry)} days ago
                                  </span>
                                ) : existingCert.expires_soon ? (
                                  <span style={{ ...styles.statusBadge, ...styles.statusExpiresSoon }}>
                                    <AlertCircle size={14} />
                                    Expires in {existingCert.days_until_expiry} days
                                  </span>
                                ) : (
                                  <span style={{ ...styles.statusBadge, ...styles.statusValid }}>
                                    <CheckCircle size={14} />
                                    Valid for {existingCert.days_until_expiry} more days
                                  </span>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={styles.certificateActions}>
                    {existingCert?.certificate_file_url ? (
                      <>
                        <button
                          style={{ ...styles.button, ...styles.viewButton }}
                          onClick={() => handleViewCertificate(existingCert.id)}
                        >
                          <Eye size={16} />
                          View
                        </button>
                        <button
                          style={{ ...styles.button, ...styles.downloadButton }}
                          onClick={() => handleDownloadCertificate(existingCert.id)}
                        >
                          <Download size={16} />
                          Download
                        </button>
                        <button
                          style={{ ...styles.button, ...styles.uploadButton }}
                          onClick={() => handleFileSelect(reqCert.certificate_id, true)}
                          disabled={uploading && uploadingForCertificate === `cert_${reqCert.certificate_id}`}
                        >
                          <Upload size={16} />
                          {uploading && uploadingForCertificate === `cert_${reqCert.certificate_id}` ? 'Uploading...' : 'Replace File'}
                        </button>
                      </>
                    ) : (
                      <button
                        style={{ ...styles.button, ...styles.uploadButton }}
                        onClick={() => handleFileSelect(reqCert.certificate_id, true)}
                        disabled={uploading && uploadingForCertificate === `cert_${reqCert.certificate_id}`}
                      >
                        <Upload size={16} />
                        {uploading && uploadingForCertificate === `cert_${reqCert.certificate_id}` ? 'Uploading...' : 'Upload Certificate'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Existing Certificates */}
      <div style={styles.card}>
        <h2 style={{ ...styles.sectionTitle, marginBottom: TavariStyles.spacing.lg }}>
          My Certificates
        </h2>
        {certificates.length === 0 ? (
          <div style={styles.emptyState}>
            <FileText size={48} style={{ marginBottom: TavariStyles.spacing.md, color: TavariStyles.colors.gray400 }} />
            <p>No certificates uploaded yet</p>
            {requiredCertificates.length === 0 && (
              <p style={{ fontSize: TavariStyles.typography.fontSize.sm, marginTop: TavariStyles.spacing.sm }}>
                Upload certificates required for your shift premiums above, or contact your manager.
              </p>
            )}
          </div>
        ) : (
          <div style={styles.certificateList}>
            {certificates.map((cert) => (
              <div key={cert.id} style={styles.certificateCard}>
                <div style={styles.certificateHeader}>
                  <div style={styles.certificateInfo}>
                    <div style={styles.certificateName}>
                      {cert.hr_certificates?.name || 'Unknown Certificate'}
                    </div>
                    <div style={styles.certificateMeta}>
                      {cert.hr_certificates?.issuing_authority && (
                        <div>Issuing Authority: {cert.hr_certificates.issuing_authority}</div>
                      )}
                      {cert.certificate_number && (
                        <div>Certificate Number: {cert.certificate_number}</div>
                      )}
                      <div>Issue Date: {formatDate(cert.issue_date)}</div>
                      {cert.expiry_date && (
                        <div>Expiry Date: {formatDate(cert.expiry_date)}</div>
                      )}
                      {cert.expiry_date && cert.days_until_expiry !== null && (
                        <div>
                          {cert.is_expired ? (
                            <span style={{ ...styles.statusBadge, ...styles.statusExpired }}>
                              <AlertCircle size={14} />
                              Expired {Math.abs(cert.days_until_expiry)} days ago
                            </span>
                          ) : cert.expires_soon ? (
                            <span style={{ ...styles.statusBadge, ...styles.statusExpiresSoon }}>
                              <AlertCircle size={14} />
                              Expires in {cert.days_until_expiry} days
                            </span>
                          ) : (
                            <span style={{ ...styles.statusBadge, ...styles.statusValid }}>
                              <CheckCircle size={14} />
                              Valid for {cert.days_until_expiry} more days
                            </span>
                          )}
                        </div>
                      )}
                      {cert.notes && (
                        <div style={{ marginTop: TavariStyles.spacing.xs, fontStyle: 'italic' }}>
                          Notes: {cert.notes}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div style={styles.certificateActions}>
                  {cert.certificate_file_url ? (
                    <>
                      <button
                        style={{ ...styles.button, ...styles.viewButton }}
                        onClick={() => handleViewCertificate(cert.id)}
                      >
                        <Eye size={16} />
                        View
                      </button>
                      <button
                        style={{ ...styles.button, ...styles.downloadButton }}
                        onClick={() => handleDownloadCertificate(cert.id)}
                      >
                        <Download size={16} />
                        Download
                      </button>
                    </>
                  ) : (
                    <button
                      style={{ ...styles.button, ...styles.uploadButton }}
                      onClick={() => handleFileSelect(cert.id)}
                      disabled={uploading && uploadingForCertificate === cert.id}
                    >
                      <Upload size={16} />
                      {uploading && uploadingForCertificate === cert.id ? 'Uploading...' : 'Upload Certificate'}
                    </button>
                  )}
                  {cert.certificate_file_url && (
                    <button
                      style={{ ...styles.button, ...styles.uploadButton }}
                      onClick={() => handleFileSelect(cert.id)}
                      disabled={uploading && uploadingForCertificate === cert.id}
                    >
                      <Upload size={16} />
                      {uploading && uploadingForCertificate === cert.id ? 'Uploading...' : 'Replace File'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {/* Certificate Form Modal */}
      {showCertificateForm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: TavariStyles.colors.white,
            borderRadius: TavariStyles.borderRadius?.lg || '12px',
            padding: TavariStyles.spacing.xl,
            maxWidth: '500px',
            width: '90%',
            maxHeight: '90vh',
            overflow: 'auto'
          }}>
            <h2 style={{
              fontSize: TavariStyles.typography.fontSize.xl,
              fontWeight: TavariStyles.typography.fontWeight.bold,
              marginBottom: TavariStyles.spacing.lg
            }}>
              Certificate Information
            </h2>
            
            <div style={{ marginBottom: TavariStyles.spacing.md }}>
              <label style={{
                display: 'block',
                fontSize: TavariStyles.typography.fontSize.sm,
                fontWeight: TavariStyles.typography.fontWeight.medium,
                color: TavariStyles.colors.gray700,
                marginBottom: TavariStyles.spacing.xs
              }}>
                Issue Date <span style={{ color: 'red' }}>*</span>
              </label>
              <DateDropdownInput
                idPrefix="portal-cert-issue"
                value={certificateFormData.issue_date}
                onChange={(iso) => setCertificateFormData((prev) => ({ ...prev, issue_date: iso }))}
                min="1900-01-01"
                max={getLocalIsoDate()}
                required
                style={{ width: '100%' }}
                selectStyle={{
                  flex: 1,
                  minWidth: 0,
                  padding: TavariStyles.spacing.sm,
                  border: `1px solid ${TavariStyles.colors.gray300}`,
                  borderRadius: TavariStyles.borderRadius?.md || '8px',
                  fontSize: TavariStyles.typography.fontSize.base
                }}
              />
            </div>

            <div style={{ marginBottom: TavariStyles.spacing.md }}>
              <label style={{
                display: 'block',
                fontSize: TavariStyles.typography.fontSize.sm,
                fontWeight: TavariStyles.typography.fontWeight.medium,
                color: TavariStyles.colors.gray700,
                marginBottom: TavariStyles.spacing.xs
              }}>
                Expiry Date (Optional)
              </label>
              <DateDropdownInput
                idPrefix="portal-cert-expiry"
                value={certificateFormData.expiry_date}
                onChange={(iso) => setCertificateFormData((prev) => ({ ...prev, expiry_date: iso }))}
                min={certificateFormData.issue_date || undefined}
                style={{ width: '100%' }}
                selectStyle={{
                  flex: 1,
                  minWidth: 0,
                  padding: TavariStyles.spacing.sm,
                  border: `1px solid ${TavariStyles.colors.gray300}`,
                  borderRadius: TavariStyles.borderRadius?.md || '8px',
                  fontSize: TavariStyles.typography.fontSize.base
                }}
              />
            </div>

            <div style={{ marginBottom: TavariStyles.spacing.lg }}>
              <label style={{
                display: 'block',
                fontSize: TavariStyles.typography.fontSize.sm,
                fontWeight: TavariStyles.typography.fontWeight.medium,
                color: TavariStyles.colors.gray700,
                marginBottom: TavariStyles.spacing.xs
              }}>
                Certificate Number (Optional)
              </label>
              <input
                type="text"
                value={certificateFormData.certificate_number}
                onChange={(e) => setCertificateFormData(prev => ({ ...prev, certificate_number: e.target.value }))}
                placeholder="Enter certificate number"
                style={{
                  width: '100%',
                  padding: TavariStyles.spacing.sm,
                  border: `1px solid ${TavariStyles.colors.gray300}`,
                  borderRadius: TavariStyles.borderRadius?.md || '8px',
                  fontSize: TavariStyles.typography.fontSize.base
                }}
              />
            </div>

            {selectedFile && (
              <div style={{
                marginBottom: TavariStyles.spacing.lg,
                padding: TavariStyles.spacing.sm,
                backgroundColor: TavariStyles.colors.gray50,
                borderRadius: TavariStyles.borderRadius?.md || '8px',
                fontSize: TavariStyles.typography.fontSize.sm,
                color: TavariStyles.colors.gray700
              }}>
                Selected file: {selectedFile.name}
              </div>
            )}

            <div style={{
              display: 'flex',
              gap: TavariStyles.spacing.md,
              justifyContent: 'flex-end'
            }}>
              <button
                onClick={() => {
                  setShowCertificateForm(false);
                  setSelectedFile(null);
                  setCertificateFormData({
                    issue_date: '',
                    expiry_date: '',
                    certificate_number: ''
                  });
                  if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                  }
                }}
                style={{
                  padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                  borderRadius: TavariStyles.borderRadius?.md || '8px',
                  border: `1px solid ${TavariStyles.colors.gray300}`,
                  backgroundColor: TavariStyles.colors.white,
                  color: TavariStyles.colors.gray700,
                  cursor: 'pointer',
                  fontSize: TavariStyles.typography.fontSize.sm,
                  fontWeight: TavariStyles.typography.fontWeight.medium
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleFormSubmit}
                disabled={uploading || !selectedFile || !certificateFormData.issue_date}
                style={{
                  padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                  borderRadius: TavariStyles.borderRadius?.md || '8px',
                  border: 'none',
                  backgroundColor: uploading || !selectedFile || !certificateFormData.issue_date 
                    ? TavariStyles.colors.gray300 
                    : TavariStyles.colors.primary,
                  color: TavariStyles.colors.white,
                  cursor: uploading || !selectedFile || !certificateFormData.issue_date ? 'not-allowed' : 'pointer',
                  fontSize: TavariStyles.typography.fontSize.sm,
                  fontWeight: TavariStyles.typography.fontWeight.medium
                }}
              >
                {uploading ? 'Uploading...' : 'Upload Certificate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PortalCertificates;

