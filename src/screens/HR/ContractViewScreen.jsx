// Contract View Screen - Public route for viewing signed contracts
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { AlertCircle, Download, X, Trash2 } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { formatDateForBusiness, formatDateShort, formatDateTimeForBusiness, getBusinessTimezone } from '../../utils/businessDateFormat';
import {
  contractHtmlNeedsRegeneration,
  extractBodyHtml,
  regenerateContractHtml,
  resolveContractPdfBlob,
  triggerBlobDownload,
} from '../../utils/contractHtmlUtils';
import { downloadContractPdf } from '../../utils/contractPdf';

const ContractViewScreen = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const [contract, setContract] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const contractContentRef = useRef(null);
  const [businessTimezone, setBusinessTimezone] = useState('America/Toronto');
  const [pdfSignedUrl, setPdfSignedUrl] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  useEffect(() => {
    loadContract();
  }, [token]);

  const loadContract = async () => {
    try {
      setLoading(true);
      setError('');

      // Load contract by viewing token (can use signing_token or authorized_representative_signing_token)
      // IMPORTANT: Load contract_data to regenerate HTML/PDF with correct information
      // IMPORTANT: Load signed_pdf_data for fully signed contracts (immutable document)
      const { data, error: contractError } = await supabase
        .from('hr_contracts')
        .select('id, business_id, employee_first_name, employee_last_name, contract_html, contract_data, status, signed_at, authorized_representative_signed_at, storage_path, pdf_url, uploaded_by, signed_pdf_data')
        .or(`signing_token.eq.${token},authorized_representative_signing_token.eq.${token}`)
        .maybeSingle();
      
      // Load business timezone if contract loaded successfully
      if (data && data.business_id) {
        try {
          const { data: bizData, error: bizError } = await supabase
            .from('businesses')
            .select('timezone')
            .eq('id', data.business_id)
            .single();
          
          if (!bizError && bizData?.timezone) {
            setBusinessTimezone(bizData.timezone);
            console.log('[ContractViewScreen] Business timezone loaded:', bizData.timezone);
          }
        } catch (err) {
          console.warn('[ContractViewScreen] Could not load business timezone, using default:', err);
        }
      }

      if (contractError) {
        console.error('Error loading contract:', contractError);
        setError('Failed to load contract: ' + contractError.message);
        setLoading(false);
        return;
      }

      if (!data) {
        setError('Contract not found. The link may be invalid or expired.');
        setLoading(false);
        return;
      }

      // Only show if contract is fully signed
      if (data.status !== 'signed') {
        setError('This contract has not been fully signed yet.');
        setLoading(false);
        return;
      }

      // If this is a legacy contract with a PDF (storage_path), generate signed URL
      if (data.storage_path && !data.contract_html) {
        try {
          const { data: signedUrlData, error: signedUrlError } = await supabase.storage
            .from('hr-documents')
            .createSignedUrl(data.storage_path, 3600); // 1 hour expiry

          if (signedUrlError) {
            console.error('Error creating signed URL:', signedUrlError);
            setError('Failed to load contract PDF: ' + signedUrlError.message);
            setLoading(false);
            return;
          }

          if (signedUrlData) {
            setPdfSignedUrl(signedUrlData.signedUrl);
          }
        } catch (err) {
          console.error('Error generating signed URL:', err);
          setError('Failed to generate contract access link.');
          setLoading(false);
          return;
        }
      }

      if (data.status === 'signed') {
        console.log('[ContractViewScreen] Fully signed contract — using stored signed HTML');
        if (contractHtmlNeedsRegeneration(data.contract_html, data.contract_data)) {
          console.warn('[ContractViewScreen] Signed contract HTML missing or too short — rebuilding from contract_data');
          try {
            data.contract_html = await regenerateContractHtml(supabase, data);
          } catch (regenErr) {
            console.error('[ContractViewScreen] Rebuild failed:', regenErr);
          }
        }
      } else if (data.contract_data) {
        // Only regenerate for contracts that haven't been fully signed yet
        // Unsigned contracts can be regenerated to show current data
        try {
          // Load business data for contract generation
          const { data: businessData } = await supabase
            .from('businesses')
            .select('*')
            .eq('id', data.business_id)
            .single();
          
          // Regenerate HTML from contract_data to ensure correct information
          const { generatePrintableHTML } = await import('../../components/HR/ContractModals');
          const regeneratedHTML = generatePrintableHTML({
            ...data.contract_data,
            businessData: businessData || {}
          });
          
          // Update contract with regenerated HTML
          data.contract_html = regeneratedHTML;
          console.log('[ContractViewScreen] Regenerated HTML from contract_data (contract not yet signed)');
        } catch (regenerateError) {
          console.warn('[ContractViewScreen] Failed to regenerate HTML from contract_data, using stored HTML:', regenerateError);
          // Continue with stored HTML if regeneration fails
        }
      }

      setContract(data);

      // Check if user can delete this contract
      // User can delete if they uploaded it, or if they have HR admin permissions
      if (data) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            // Check if user uploaded it
            if (data.uploaded_by === user.id) {
              setCanDelete(true);
            } else {
              // Check if user has HR admin permissions
              const { data: userRoles } = await supabase
                .from('user_roles')
                .select('role')
                .eq('user_id', user.id)
                .eq('business_id', data.business_id)
                .eq('active', true)
                .single();
              
              if (userRoles && ['owner', 'admin', 'hr_admin', 'manager'].includes(userRoles.role?.toLowerCase())) {
                setCanDelete(true);
              }
            }
          }
        } catch (permError) {
          console.warn('Error checking delete permissions:', permError);
          // Don't block the view if permission check fails
        }
      }

      setLoading(false);
    } catch (err) {
      console.error('Error loading contract:', err);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  const handleDeleteContract = async () => {
    if (!contract) return;

    if (!confirm('Are you sure you want to delete this contract? This action cannot be undone.')) {
      return;
    }

    setDeleting(true);
    try {
      // Delete file from storage if storage_path exists
      if (contract.storage_path) {
        const { error: storageError } = await supabase.storage
          .from('hr-documents')
          .remove([contract.storage_path]);

        if (storageError) {
          console.warn('Error deleting file from storage:', storageError);
          // Continue with database deletion even if storage delete fails
        }
      }

      // Delete contract record from database
      const { error: dbError } = await supabase
        .from('hr_contracts')
        .delete()
        .eq('id', contract.id);

      if (dbError) {
        throw new Error(`Failed to delete contract: ${dbError.message}`);
      }

      toast.success('Contract deleted successfully');
      
      // Navigate away after deletion
      navigate('/');
    } catch (error) {
      console.error('Error deleting contract:', error);
      toast.error('Failed to delete contract: ' + error.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (!contract) {
      toast.error('Contract not available for download');
      return;
    }

    setDownloading(true);
    try {
      const filename = `Signed_Employment_Contract_${contract.employee_first_name}_${contract.employee_last_name}.pdf`;
      let html = contract.contract_html || '';
      if (contract.status !== 'signed' && contract.contract_data) {
        html = await regenerateContractHtml(supabase, contract) || html;
      }

      if (html) {
        toast.loading('Generating PDF...', { id: 'contract-pdf-download' });
        await downloadContractPdf(html, filename);
        toast.success('Contract downloaded successfully', { id: 'contract-pdf-download' });
        return;
      }

      const pdfBlob = await resolveContractPdfBlob({
        contract,
        supabaseClient: supabase,
      });

      if (!pdfBlob) {
        toast.error('Contract content not available for download', { id: 'contract-pdf-download' });
        return;
      }

      triggerBlobDownload(pdfBlob, filename);
      toast.success('Contract downloaded successfully', { id: 'contract-pdf-download' });
    } catch (err) {
      console.error('[ContractView] Error generating PDF:', err);
      toast.error('Failed to download contract. Please try again.', { id: 'contract-pdf-download' });
    } finally {
      setDownloading(false);
    }
  };

  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.xl,
      paddingTop: TavariStyles.spacing['3xl']
    },
    card: {
      maxWidth: '1200px',
      margin: '0 auto',
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      boxShadow: TavariStyles.shadows.md,
      padding: TavariStyles.spacing.xl
    },
    header: {
      marginBottom: TavariStyles.spacing.xl,
      borderBottom: `2px solid ${TavariStyles.colors.primary}`,
      paddingBottom: TavariStyles.spacing.lg,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      fontFamily: TavariStyles.typography.fontFamily,
      color: TavariStyles.colors.primary,
      margin: 0
    },
    button: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.white,
      backgroundColor: TavariStyles.colors.primary,
      border: 'none',
      borderRadius: TavariStyles.borderRadius.md,
      cursor: 'pointer',
      transition: '0.2s ease',
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    errorMessage: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      marginBottom: TavariStyles.spacing.lg
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p>Loading contract...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.header}>
            <h1 style={styles.title}>View Contract</h1>
          </div>
          <div style={styles.errorMessage}>
            <AlertCircle size={20} style={{ marginRight: '8px' }} />
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!contract) {
    return null;
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h1 style={styles.title}>Signed Employment Contract</h1>
          <div style={{ display: 'flex', gap: TavariStyles.spacing.md }}>
            <button
              onClick={handleDownloadPDF}
              disabled={downloading}
              style={{
                ...styles.button,
                opacity: downloading ? 0.6 : 1,
                cursor: downloading ? 'not-allowed' : 'pointer'
              }}
              onMouseEnter={(e) => {
                if (!downloading) e.target.style.backgroundColor = TavariStyles.colors.primaryDark;
              }}
              onMouseLeave={(e) => {
                if (!downloading) e.target.style.backgroundColor = TavariStyles.colors.primary;
              }}
            >
              <Download size={18} />
              {downloading ? 'Generating PDF...' : 'Download PDF'}
            </button>
            {canDelete && (
              <button
                onClick={handleDeleteContract}
                disabled={deleting}
                style={{
                  ...styles.button,
                  backgroundColor: TavariStyles.colors.danger,
                  opacity: deleting ? 0.6 : 1,
                  cursor: deleting ? 'not-allowed' : 'pointer'
                }}
                onMouseEnter={(e) => {
                  if (!deleting) e.target.style.backgroundColor = TavariStyles.colors.danger + 'DD';
                }}
                onMouseLeave={(e) => {
                  if (!deleting) e.target.style.backgroundColor = TavariStyles.colors.danger;
                }}
              >
                <Trash2 size={18} />
                {deleting ? 'Deleting...' : 'Delete Contract'}
              </button>
            )}
            <button
              onClick={() => navigate('/')}
              style={{
                ...styles.button,
                backgroundColor: TavariStyles.colors.gray600
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = TavariStyles.colors.gray700}
              onMouseLeave={(e) => e.target.style.backgroundColor = TavariStyles.colors.gray600}
            >
              <X size={18} />
              Close
            </button>
          </div>
        </div>

        {contract.contract_html && (
          <div 
            ref={contractContentRef}
            style={{
              border: `1px solid ${TavariStyles.colors.gray200}`,
              borderRadius: TavariStyles.borderRadius.md,
              padding: TavariStyles.spacing.xl,
              backgroundColor: TavariStyles.colors.white,
              color: '#000',
              fontSize: '13px',
              lineHeight: 1.5,
            }}
            dangerouslySetInnerHTML={{ __html: extractBodyHtml(contract.contract_html) }}
          />
        )}

        {!contract.contract_html && !pdfSignedUrl && (
          <div style={styles.errorMessage}>
            <AlertCircle size={20} style={{ marginRight: '8px' }} />
            Contract content is not available. Please contact HR for a copy.
          </div>
        )}

        {pdfSignedUrl && (
          <div style={{
            border: `1px solid ${TavariStyles.colors.gray200}`,
            borderRadius: TavariStyles.borderRadius.md,
            padding: TavariStyles.spacing.xl,
            backgroundColor: TavariStyles.colors.white,
            minHeight: '600px'
          }}>
            <iframe
              src={pdfSignedUrl}
              style={{
                width: '100%',
                height: '800px',
                border: 'none'
              }}
              title="Contract PDF"
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default ContractViewScreen;

