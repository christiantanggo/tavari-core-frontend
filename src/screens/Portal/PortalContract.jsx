// PortalContract.jsx - Employee Portal Contract View
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { Download, FileText, Eye, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { getPublicUserId } from '../../utils/getPublicUserId';
import { resolveContractPdfBlob, triggerBlobDownload } from '../../utils/contractHtmlUtils';
import { downloadContractPdf } from '../../utils/contractPdf';

const PortalContract = () => {
  const navigate = useNavigate();
  const [contracts, setContracts] = useState([]);
  const [legacyContracts, setLegacyContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedContract, setSelectedContract] = useState(null);
  const [viewingContract, setViewingContract] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const contractContentRef = useRef(null);

  useEffect(() => {
    loadContracts();
  }, []);

  const loadContracts = async () => {
    try {
      setLoading(true);
      
      // Get current user
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        navigate('/portal/login');
        return;
      }

      // Get public.users.id
      const userId = await getPublicUserId(currentUser.email);
      if (!userId) {
        toast.error('User profile not found');
        return;
      }

      // Load digital contracts from hr_contracts
      // IMPORTANT: Load contract_data to regenerate HTML/PDF with correct information
      // IMPORTANT: Load signed_pdf_data for fully signed contracts (immutable document)
      const { data: digitalContracts, error: digitalError } = await supabase
        .from('hr_contracts')
        .select(`
          id,
          employee_id,
          employee_email,
          contract_html,
          contract_data,
          signed_pdf_data,
          status,
          signed_at,
          created_at,
          pdf_url,
          storage_path,
          employee_first_name,
          employee_last_name,
          business_id
        `)
        .eq('employee_id', userId)
        .in('status', ['signed', 'employee_signed'])
        .order('created_at', { ascending: false });

      if (digitalError) {
        console.error('Error loading digital contracts:', digitalError);
      } else {
        setContracts(digitalContracts || []);
      }

      // Load legacy contracts from contract_files (if table exists)
      try {
        const { data: legacyFiles, error: legacyError } = await supabase
          .from('contract_files')
          .select(`
            id,
            file_name,
            storage_path,
            file_type,
            uploaded_at,
            file_size
          `)
          .eq('employee_id', userId)
          .order('uploaded_at', { ascending: false });

        if (legacyError) {
          // Table might not exist or have different structure - that's okay
          console.log('Legacy contracts not available:', legacyError.message);
          setLegacyContracts([]);
        } else {
          setLegacyContracts(legacyFiles || []);
        }
      } catch (err) {
        console.log('Legacy contracts table not accessible:', err);
        setLegacyContracts([]);
      }

    } catch (error) {
      console.error('Error loading contracts:', error);
      toast.error('Error loading contracts');
    } finally {
      setLoading(false);
    }
  };

  const handleViewContract = async (contract) => {
    // CRITICAL FIX: For fully signed contracts, use stored signed HTML (immutable document)
    // Only regenerate for contracts that haven't been fully signed yet
    let contractToView = { ...contract };
    
    if (contract.status === 'signed') {
      // For fully signed contracts, use the stored contract_html with signatures embedded
      // This represents exactly what was signed at the time
      console.log('[PortalContract] Contract is fully signed - using stored signed HTML');
      // contract_html should already have both signatures embedded
    } else if (contract.contract_data) {
      // Only regenerate for contracts that haven't been fully signed yet
      try {
        // Load business data for contract generation
        const { data: businessData } = await supabase
          .from('businesses')
          .select('*')
          .eq('id', contract.business_id)
          .single();
        
        // Regenerate HTML from contract_data to ensure correct information
        const { generatePrintableHTML } = await import('../../components/HR/ContractModals');
        const regeneratedHTML = generatePrintableHTML({
          ...contract.contract_data,
          businessData: businessData || {}
        });
        
        // Update contract with regenerated HTML
        contractToView.contract_html = regeneratedHTML;
        console.log('[PortalContract] Regenerated HTML from contract_data for viewing');
      } catch (regenerateError) {
        console.warn('[PortalContract] Failed to regenerate HTML from contract_data, using stored HTML:', regenerateError);
        // Continue with stored HTML if regeneration fails
      }
    }
    
    setSelectedContract(contractToView);
    setViewingContract(true);
  };

  const handleDownloadContract = async (contract) => {
    if (!contract) return;

    setDownloading(true);
    try {
      const filename = `Signed_Contract_${contract.employee_first_name || ''}_${contract.employee_last_name || ''}_${contract.id}.pdf`;
      let html = contract.contract_html || '';

      if (contract.status !== 'signed' && contract.contract_data) {
        try {
          const { data: businessData } = await supabase
            .from('businesses')
            .select('*')
            .eq('id', contract.business_id)
            .single();
          const { generatePrintableHTML } = await import('../../components/HR/ContractModals');
          html = generatePrintableHTML({
            ...contract.contract_data,
            businessData: businessData || {},
          });
        } catch (regenerateError) {
          console.warn('[PortalContract] Failed to regenerate HTML from contract_data:', regenerateError);
        }
      }

      if (html) {
        toast.loading('Generating PDF...', { id: 'portal-contract-pdf' });
        await downloadContractPdf(html, filename);
        toast.success('Contract downloaded successfully', { id: 'portal-contract-pdf' });
        return;
      }

      const pdfBlob = await resolveContractPdfBlob({
        contract,
        supabaseClient: supabase,
      });

      if (!pdfBlob) {
        toast.error('Contract content not available for download', { id: 'portal-contract-pdf' });
        return;
      }

      triggerBlobDownload(pdfBlob, filename);
      toast.success('Contract downloaded successfully', { id: 'portal-contract-pdf' });
    } catch (error) {
      console.error('Error downloading contract:', error);
      toast.error('Failed to download contract', { id: 'portal-contract-pdf' });
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadLegacyContract = async (legacyFile) => {
    try {
      if (!legacyFile.storage_path) {
        toast.error('Contract file path is missing');
        return;
      }

      // Clean the storage path - remove any leading slashes or bucket prefixes
      let cleanPath = legacyFile.storage_path.trim();
      if (cleanPath.startsWith('hr-documents/')) {
        cleanPath = cleanPath.replace('hr-documents/', '');
      }
      if (cleanPath.startsWith('/')) {
        cleanPath = cleanPath.substring(1);
      }

      console.log('[PortalContract] Downloading legacy contract:', {
        original_path: legacyFile.storage_path,
        clean_path: cleanPath,
        file_name: legacyFile.file_name
      });

      const { data, error } = await supabase.storage
        .from('hr-documents')
        .download(cleanPath);

      if (error) {
        console.error('[PortalContract] Storage download error:', error);
        // If download fails, try to get a signed URL instead
        const { data: signedUrlData, error: signedUrlError } = await supabase.storage
          .from('hr-documents')
          .createSignedUrl(cleanPath, 3600); // 1 hour expiry

        if (signedUrlError) {
          throw new Error(`File not found or inaccessible: ${signedUrlError.message}`);
        }

        // Download via signed URL
        const response = await fetch(signedUrlData.signedUrl);
        if (!response.ok) {
          throw new Error(`Failed to download file: ${response.statusText}`);
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = legacyFile.file_name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success('Contract downloaded successfully');
        return;
      }

      if (!data) {
        throw new Error('No file data returned');
      }

      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = legacyFile.file_name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('Contract downloaded successfully');
    } catch (error) {
      console.error('Error downloading legacy contract:', error);
      console.error('Legacy file details:', legacyFile);
      toast.error(`Failed to download contract: ${error.message || 'File not found or inaccessible'}`);
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
    section: {
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
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.lg
    },
    contractList: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.md,
      minWidth: 0
    },
    contractCard: {
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      padding: TavariStyles.spacing.lg,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      transition: 'all 0.2s',
      gap: TavariStyles.spacing.md,
      flexWrap: 'wrap',
      minWidth: 0,
      boxSizing: 'border-box',
      overflowWrap: 'anywhere'
    },
    contractInfo: {
      flex: '1 1 220px',
      minWidth: 0
    },
    contractTitle: {
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.xs
    },
    contractMeta: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    contractActions: {
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
      maxWidth: '100%',
      boxSizing: 'border-box',
      fontWeight: TavariStyles.typography.fontWeight.medium,
      transition: 'all 0.2s'
    },
    viewButton: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white
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
    modal: {
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
      padding: TavariStyles.spacing.xl
    },
    modalContent: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      maxWidth: '900px',
      width: '100%',
      maxHeight: '90vh',
      overflow: 'auto',
      padding: TavariStyles.spacing.xl,
      position: 'relative'
    },
    modalHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.lg,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      paddingBottom: TavariStyles.spacing.md
    },
    modalTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900
    },
    closeButton: {
      background: 'none',
      border: 'none',
      fontSize: TavariStyles.typography.fontSize['2xl'],
      cursor: 'pointer',
      color: TavariStyles.colors.gray600,
      padding: 0,
      width: '32px',
      height: '32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    },
    contractContent: {
      fontSize: TavariStyles.typography.fontSize.base,
      lineHeight: 1.6,
      color: TavariStyles.colors.gray900
    },
    loading: {
      textAlign: 'center',
      padding: TavariStyles.spacing['3xl'],
      color: TavariStyles.colors.gray600
    }
  };

  if (loading) {
    return (
      <div style={styles.loading}>Loading contracts...</div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>My Contract</h1>
        <p style={styles.subtitle}>View and download your employment contracts</p>
      </div>

      {/* Digital Contracts */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Digital Contracts</h2>
        {contracts.length === 0 ? (
          <div style={styles.emptyState}>
            <FileText size={48} style={{ marginBottom: TavariStyles.spacing.md, color: TavariStyles.colors.gray400 }} />
            <p>No digital contracts found</p>
          </div>
        ) : (
          <div style={styles.contractList}>
            {contracts.map((contract) => (
              <div key={contract.id} style={styles.contractCard}>
                <div style={styles.contractInfo}>
                  <div style={styles.contractTitle}>
                    Employment Contract
                  </div>
                  <div style={styles.contractMeta}>
                    Signed: {formatDate(contract.signed_at)} | Created: {formatDate(contract.created_at)}
                  </div>
                </div>
                <div style={styles.contractActions}>
                  <button
                    style={{ ...styles.button, ...styles.viewButton }}
                    onClick={() => handleViewContract(contract)}
                  >
                    <Eye size={16} />
                    View
                  </button>
                  <button
                    style={{ ...styles.button, ...styles.downloadButton }}
                    onClick={() => handleDownloadContract(contract)}
                    disabled={downloading}
                  >
                    <Download size={16} />
                    Download
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legacy Contracts */}
      {legacyContracts.length > 0 && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Legacy Contracts</h2>
          <div style={styles.contractList}>
            {legacyContracts.map((file) => (
              <div key={file.id} style={styles.contractCard}>
                <div style={styles.contractInfo}>
                  <div style={styles.contractTitle}>
                    {file.file_name}
                  </div>
                  <div style={styles.contractMeta}>
                    Uploaded: {formatDate(file.uploaded_at)} | Type: {file.file_type || 'PDF'}
                  </div>
                </div>
                <div style={styles.contractActions}>
                  <button
                    style={{ ...styles.button, ...styles.downloadButton }}
                    onClick={() => handleDownloadLegacyContract(file)}
                  >
                    <Download size={16} />
                    Download
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Contract View Modal */}
      {viewingContract && selectedContract && (
        <div style={styles.modal} onClick={() => setViewingContract(false)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>Employment Contract</h2>
              <button
                style={styles.closeButton}
                onClick={() => setViewingContract(false)}
              >
                ×
              </button>
            </div>
            <div
              ref={contractContentRef}
              style={styles.contractContent}
              dangerouslySetInnerHTML={{ __html: selectedContract.contract_html }}
            />
            <div style={{ marginTop: TavariStyles.spacing.lg, display: 'flex', gap: TavariStyles.spacing.md, justifyContent: 'flex-end' }}>
              <button
                style={{ ...styles.button, ...styles.downloadButton }}
                onClick={() => handleDownloadContract(selectedContract)}
                disabled={downloading}
              >
                <Download size={16} />
                Download PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PortalContract;

