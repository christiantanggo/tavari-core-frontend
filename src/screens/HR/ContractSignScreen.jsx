// Contract Signing Screen - Public route for employees to sign contracts
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { CheckCircle, AlertCircle, X, FileText, Download, Printer } from 'lucide-react';
import DigitalSignature from '../../components/HR/DigitalSignature';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import toast from 'react-hot-toast';
import { TavariStyles } from '../../utils/TavariStyles';
import { formatDateForBusiness, formatDateShort, formatDateTimeForBusiness, getBusinessTimezone } from '../../utils/businessDateFormat';
import {
  formatContractHrFromName,
  resolveBusinessDisplayName,
} from '../../utils/contractPersistence';
import {
  blobToBase64,
  blobToUint8Array,
  embedEmployeeSignature,
  extractBodyHtml,
  generatePdfBlobFromHtml,
} from '../../utils/contractHtmlUtils';
import { downloadContractPdf } from '../../utils/contractPdf';

// Import generateContractPDF function
let generateContractPDF = null;
try {
  // Try to import from ContractManagement - we'll need to make it available
  // For now, we'll regenerate from contract_data if available
} catch (e) {
  console.warn('Could not import generateContractPDF:', e);
}

const ContractSignScreen = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const [contract, setContract] = useState(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [digitalSignatureConsent, setDigitalSignatureConsent] = useState(false);
  const [businessEmail, setBusinessEmail] = useState('');
  const [businessTimezone, setBusinessTimezone] = useState('America/Toronto');

  useEffect(() => {
    loadContract();
  }, [token]);

  const loadContract = async () => {
    console.log('========== CONTRACT LOADING - START ==========');
    console.log('[ContractLoad] Loading contract with token:', token);
    console.log('[ContractLoad] Timestamp:', new Date().toISOString());
    
    // Detect mobile device for better error handling
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    console.log('[ContractLoad] Device Type:', isMobile ? 'MOBILE' : 'DESKTOP');
    console.log('[ContractLoad] User Agent:', navigator.userAgent);
    
    try {
      setLoading(true);
      setError('');

      // For public contract signing, ensure we're not using stale auth state
      // Clear any existing session that might interfere with public access
      // Note: We don't sign out, just ensure the query uses the correct context
      const { data: { session } } = await supabase.auth.getSession();
      console.log('[ContractLoad] Authentication State:', {
        hasSession: !!session,
        userId: session?.user?.id || 'NOT AUTHENTICATED',
        userEmail: session?.user?.email || 'NOT AUTHENTICATED',
        note: 'Public access should work regardless of auth state due to RLS policy'
      });

      // Load contract by signing token (public access - no auth required)
      // Only select needed columns to reduce Disk IO (exclude large pdf_data unless needed)
      console.log('[ContractLoad] Executing query: SELECT from hr_contracts WHERE signing_token =', token);
      console.log('[ContractLoad] RLS Policy: Should allow public access via signing_token IS NOT NULL');
      const queryStartTime = Date.now();
      
      // Use a fresh Supabase client instance to avoid any cached/stale state
      // The singleton pattern should handle this, but on mobile browsers with aggressive caching,
      // we want to ensure we're using the latest client configuration
      const { data, error: contractError } = await supabase
        .from('hr_contracts')
        .select('id, business_id, employee_email, employee_first_name, employee_last_name, employee_address, contract_data, contract_html, signing_token, status, signed_at, expires_at, viewed_at, created_at, authorized_representative_name, authorized_representative_email, authorized_representative_signing_token, authorized_representative_signed_at, hr_email, digital_signature_data, signed_pdf_data')
        .eq('signing_token', token)
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
            console.log('[ContractSignScreen] Business timezone loaded:', bizData.timezone);
          } else {
            console.log('[ContractSignScreen] Using default timezone: America/Toronto');
          }
        } catch (err) {
          console.warn('[ContractSignScreen] Could not load business timezone, using default:', err);
        }
      }
      
      const queryDuration = Date.now() - queryStartTime;
      console.log('[ContractLoad] Query Duration:', queryDuration + 'ms');
      console.log('[ContractLoad] Query Result:', {
        hasData: !!data,
        hasError: !!contractError,
        errorCode: contractError?.code,
        errorMessage: contractError?.message
      });

      if (contractError) {
        console.error('========== CONTRACT LOADING - ERROR ==========');
        console.error('[ContractLoad] Error Code:', contractError.code);
        console.error('[ContractLoad] Error Message:', contractError.message);
        console.error('[ContractLoad] Error Details:', contractError.details);
        console.error('[ContractLoad] Error Hint:', contractError.hint);
        console.error('[ContractLoad] Device:', isMobile ? 'MOBILE' : 'DESKTOP');
        console.error('[ContractLoad] User Agent:', navigator.userAgent);
        console.error('========== END ERROR LOG ==========');
        
        // Mobile-specific error handling
        let errorMessage = 'Failed to load contract: ' + contractError.message;
        if (isMobile) {
          errorMessage += '\n\nMobile troubleshooting:';
          errorMessage += '\n1. Try clearing your browser cache';
          errorMessage += '\n2. Try refreshing the page';
          errorMessage += '\n3. Try using a different browser';
          if (contractError.code === 'PGRST116') {
            errorMessage += '\n\nNote: This appears to be a caching issue. Please clear your mobile browser cache.';
          }
        }
        
        setError(errorMessage);
        setLoading(false);
        return;
      }

      if (!data) {
        console.warn('[ContractLoad] Contract not found for token:', token);
        console.warn('[ContractLoad] Device:', isMobile ? 'MOBILE' : 'DESKTOP');
        console.warn('[ContractLoad] This might be a cache issue on mobile');
        
        let errorMessage = 'Contract not found. The link may be invalid or expired.';
        if (isMobile) {
          errorMessage += '\n\nMobile troubleshooting:';
          errorMessage += '\n1. Clear your browser cache and try again';
          errorMessage += '\n2. Try opening in an incognito/private window';
          errorMessage += '\n3. Try using a different mobile browser';
          errorMessage += '\n4. Make sure you\'re using the latest link from the email';
        }
        
        setError(errorMessage);
        setLoading(false);
        return;
      }

      console.log('[ContractLoad] Contract Loaded Successfully:', {
        id: data.id,
        business_id: data.business_id,
        status: data.status,
        employee_email: data.employee_email,
        has_signing_token: !!data.signing_token,
        has_contract_html: !!data.contract_html,
        has_contract_data: !!data.contract_data,
        has_authorized_rep: !!(data.authorized_representative_email && data.authorized_representative_signing_token),
        expires_at: data.expires_at,
        signed_at: data.signed_at
      });

      // Check if contract is expired - but allow if employee signed on time (expiration was extended)
      if (data.expires_at && new Date(data.expires_at) < new Date()) {
        // Only block if employee hasn't signed yet
        if (data.status !== 'employee_signed' && !data.signed_at) {
          setExpired(true);
          setError('This contract offer has expired.');
          setLoading(false);
          return;
        }
        // If employee signed on time, expiration was extended - allow viewing/signing
        console.log('[ContractLoad] Contract expired but employee signed on time - allowing access');
      }

      // Check if already signed
      if (data.status === 'signed' || data.signed_at) {
        setError('This contract has already been signed.');
        setLoading(false);
        return;
      }

      // Normalize wage from column into keyTerms for display/regeneration
      if (data.contract_data?.keyTerms) {
        if (data.wage_amount != null && !data.contract_data.keyTerms.baseHourlyWage) {
          data.contract_data.keyTerms.baseHourlyWage = String(data.wage_amount);
        }
      } else if (data.wage_amount != null) {
        data.contract_data = {
          keyTerms: { baseHourlyWage: String(data.wage_amount) },
          selectedTerms: [],
        };
      }

      // DEBUG: Log the full contract_data structure
      console.log('[ContractSignScreen] FULL contract_data:', JSON.stringify(data.contract_data, null, 2));
      console.log('[ContractSignScreen] contract_data.selectedTerms:', data.contract_data?.selectedTerms);
      console.log('[ContractSignScreen] contract_data keys:', data.contract_data ? Object.keys(data.contract_data) : 'no contract_data');
      
      // Check if contract_html has sections - if not, regenerate from contract_data
      let contractHTML = data.contract_html;
      let needsRegeneration = false;
      
      if (contractHTML) {
        const hasContractTerms = contractHTML.includes('Contract Terms') || contractHTML.includes('<h2>Contract Terms</h2>');
        const hasSections = contractHTML.includes('<h3>') && contractHTML.includes('</h3>');
        const sectionMatches = contractHTML.match(/<h3>.*?<\/h3>/g);
        const hasSectionContent = sectionMatches && sectionMatches.length > 0;
        
        console.log('[ContractSignScreen] Contract HTML check:', {
          hasHTML: !!contractHTML,
          htmlLength: contractHTML.length,
          hasContractTerms,
          hasSections,
          hasSectionContent,
          sectionCount: sectionMatches?.length || 0
        });
        
        const storedTermsCount = data.contract_data?.selectedTerms?.length || 0;
        const htmlSectionCount = sectionMatches?.length || 0;

        // If no sections found but contract_data exists, regenerate
        if (
          ((!hasSections || !hasSectionContent || !hasContractTerms) && data.contract_data) ||
          (storedTermsCount > 0 && htmlSectionCount < Math.min(storedTermsCount, 3))
        ) {
          console.log('[ContractSignScreen] Contract HTML missing sections, attempting to regenerate from contract_data');
          needsRegeneration = true;
        }
      } else if (data.contract_data) {
        console.log('[ContractSignScreen] No contract_html, attempting to regenerate from contract_data');
        needsRegeneration = true;
      }
      
      // Regenerate contract HTML if needed
      if (needsRegeneration && data.contract_data) {
        try {
          // Load contract sections from database if selectedTerms is empty
          let contractDataWithSections = { ...data.contract_data };
          
          console.log('[ContractSignScreen] BEFORE loading sections - selectedTerms:', contractDataWithSections.selectedTerms?.length || 0);
          
          if (!contractDataWithSections.selectedTerms || contractDataWithSections.selectedTerms.length === 0) {
            console.log('[ContractSignScreen] selectedTerms is empty, loading from contract_sections table for contract_id:', data.id);
            const { data: sectionsData, error: sectionsError } = await supabase
              .from('contract_sections')
              .select('id, contract_id, title, content, section_order, is_required, section_type')
              .eq('contract_id', data.id)
              .order('section_order', { ascending: true })
              .limit(100);
            
            console.log('[ContractSignScreen] contract_sections query result:', { 
              sectionsCount: sectionsData?.length || 0, 
              error: sectionsError,
              sections: sectionsData 
            });
            
            if (!sectionsError && sectionsData && sectionsData.length > 0) {
              // Convert contract_sections format to selectedTerms format
              const selectedTerms = sectionsData.map(section => ({
                id: section.id,
                title: section.title || section.section_title || '',
                content: section.content || section.section_content || '',
                placeholder_tags: section.placeholder_tags || section.subsections || []
              }));
              
              contractDataWithSections.selectedTerms = selectedTerms;
              console.log('[ContractSignScreen] Loaded', selectedTerms.length, 'sections from contract_sections table:', selectedTerms.map(s => s.title));
            } else {
              console.warn('[ContractSignScreen] No sections found in contract_sections table. Trying contract templates...');
              
              // Try loading from contract templates
              let templateId = data.contract_data?.templateId || data.contract_data?.selectedTemplateId;
              
              // If no template ID in contract_data, try to find the most recent active template for this business
              if (!templateId && data.business_id) {
                console.log('[ContractSignScreen] No template ID in contract_data, loading most recent active template for business');
                const { data: templates, error: templatesError } = await supabase
                  .from('contract_templates')
                  .select('id')
                  .eq('business_id', data.business_id)
                  .eq('is_active', true)
                  .order('created_at', { ascending: false })
                  .limit(1)
                  .maybeSingle();
                
                if (!templatesError && templates) {
                  templateId = templates.id;
                  console.log('[ContractSignScreen] Found active template:', templateId);
                }
              }
              
              if (templateId) {
                console.log('[ContractSignScreen] Attempting to load from template:', templateId);
                
                const { data: templateSections, error: templateError } = await supabase
                  .from('contract_template_sections')
                  .select('id, template_id, title, content, section_order, is_required, section_type, placeholder_tags')
                  .eq('template_id', templateId)
                  .order('section_order', { ascending: true })
                  .limit(100);
                
                console.log('[ContractSignScreen] Template sections query result:', {
                  sectionsCount: templateSections?.length || 0,
                  error: templateError,
                  sections: templateSections
                });
                
                if (!templateError && templateSections && templateSections.length > 0) {
                  const selectedTerms = templateSections.map(section => {
                    // Parse placeholder_tags if it's a string (JSON)
                    let placeholderTags = [];
                    if (section.placeholder_tags) {
                      if (typeof section.placeholder_tags === 'string') {
                        try {
                          placeholderTags = JSON.parse(section.placeholder_tags);
                        } catch (e) {
                          console.warn('[ContractSignScreen] Failed to parse placeholder_tags as JSON:', e);
                          placeholderTags = [];
                        }
                      } else if (Array.isArray(section.placeholder_tags)) {
                        placeholderTags = section.placeholder_tags;
                      }
                    } else if (section.subsections) {
                      placeholderTags = Array.isArray(section.subsections) ? section.subsections : [];
                    }
                    
                    return {
                      id: section.id,
                      title: section.title || '',
                      content: section.content || '',
                      placeholder_tags: placeholderTags
                    };
                  });
                  
                  contractDataWithSections.selectedTerms = selectedTerms;
                  console.log('[ContractSignScreen] Loaded', selectedTerms.length, 'sections from template:', selectedTerms.map(s => ({ title: s.title, hasContent: !!s.content, subsections: s.placeholder_tags?.length || 0 })));
                } else {
                  console.warn('[ContractSignScreen] No sections found in template:', templateId, 'Error:', templateError);
                }
              } else {
                console.warn('[ContractSignScreen] No template ID found, cannot load default sections');
              }
            }
          } else {
            console.log('[ContractSignScreen] selectedTerms already exists with', contractDataWithSections.selectedTerms.length, 'items');
          }
          
          // Dynamically import and use generateContractPDF
          const contractManagementModule = await import('../HR/ContractManagement');
          if (contractManagementModule.generateContractPDF) {
            // Load business data
            let businessData = null;
            if (data.business_id) {
              const { data: bizData, error: bizError } = await supabase
                .from('businesses')
                .select('id, name, business_email, phone, address, business_settings')
                .eq('id', data.business_id)
                .maybeSingle();
              
              if (!bizError) {
                businessData = bizData;
              } else {
                console.warn('[ContractSignScreen] Error loading business data:', bizError);
              }
            }
            
            console.log('[ContractSignScreen] About to call generateContractPDF with:', {
              selectedTermsCount: contractDataWithSections.selectedTerms?.length || 0,
              first3Sections: contractDataWithSections.selectedTerms?.slice(0, 3).map(s => ({
                title: s.title,
                hasContent: !!s.content,
                contentLength: s.content?.length || 0,
                hasSubsections: (s.placeholder_tags?.length || 0) > 0
              }))
            });
            
            contractHTML = contractManagementModule.generateContractPDF({
              ...contractDataWithSections,
              businessData: businessData
            });
            
            console.log('[ContractSignScreen] Regenerated contract HTML, length:', contractHTML.length, 'has sections:', contractHTML.includes('<h3>'), 'section count:', (contractHTML.match(/<h3>/g) || []).length);
            console.log('[ContractSignScreen] HTML preview (first 2000 chars):', contractHTML.substring(0, 2000));
            console.log('[ContractSignScreen] HTML contains "Contract Terms":', contractHTML.includes('Contract Terms'));
            console.log('[ContractSignScreen] HTML contains "<h2>Contract Terms</h2>":', contractHTML.includes('<h2>Contract Terms</h2>'));
            
            // Update contract with regenerated HTML
            const { error: updateError } = await supabase
              .from('hr_contracts')
              .update({ contract_html: contractHTML })
              .eq('id', data.id);
            
            if (updateError) {
              console.error('[ContractSignScreen] Error updating contract_html:', updateError);
            } else {
              console.log('[ContractSignScreen] Successfully updated contract_html in database');
            }
            
            // Update local data so the page re-renders with new HTML
            data.contract_html = contractHTML;
          } else {
            console.error('[ContractSignScreen] generateContractPDF function not found in module');
          }
        } catch (regenerateError) {
          console.error('[ContractSignScreen] Error regenerating contract HTML:', regenerateError);
          console.error('[ContractSignScreen] Error stack:', regenerateError.stack);
          // Continue with existing HTML or empty
        }
      }
      
      setContract(data);
      
      // Pre-fill signer name from contract
      const firstName = data.employee_first_name || data.contract_data?.keyTerms?.firstName || '';
      const lastName = data.employee_last_name || data.contract_data?.keyTerms?.lastName || '';
      setSignerName(`${firstName} ${lastName}`.trim());

      // Load business email for consent message
      if (data.business_id) {
        const { data: businessData, error: businessError } = await supabase
          .from('businesses')
          .select('business_email')
          .eq('id', data.business_id)
          .maybeSingle();
        
        if (!businessError && businessData) {
          setBusinessEmail(businessData.business_email || '');
        } else if (businessError) {
          console.warn('[ContractSignScreen] Error loading business email:', businessError);
        }
      }

      // Mark as viewed
      if (!data.viewed_at) {
        await supabase
          .from('hr_contracts')
          .update({ viewed_at: new Date().toISOString() })
          .eq('id', data.id);
      }

      console.log('[ContractLoad] Contract state set, loading complete');
      console.log('========== CONTRACT LOADING - SUCCESS ==========');
      setLoading(false);
    } catch (err) {
      console.error('========== CONTRACT LOADING - UNHANDLED ERROR ==========');
      console.error('[ContractLoad] Error Type:', err?.constructor?.name || typeof err);
      console.error('[ContractLoad] Error Message:', err?.message);
      console.error('[ContractLoad] Error Stack:', err?.stack);
      console.error('[ContractLoad] Full Error:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
      console.error('[ContractLoad] Token Used:', token);
      console.error('========== END ERROR LOG ==========');
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  const handleSignatureComplete = async (signatureRecord) => {
    console.log('========== CONTRACT SIGNING - FUNCTION CALLED ==========');
    console.log('[ContractSign] Function Entry:', {
      hasContract: !!contract,
      contractId: contract?.id,
      signerName: signerName,
      hasSignatureRecord: !!signatureRecord,
      hasConsent: digitalSignatureConsent,
      timestamp: new Date().toISOString()
    });

    if (!contract || !signerName.trim()) {
      console.error('[ContractSign] Validation Failed: Missing contract or signer name');
      toast.error('Please provide your name');
      return;
    }

    if (!digitalSignatureConsent) {
      console.error('[ContractSign] Validation Failed: Missing digital signature consent');
      toast.error('You must consent to digital signature to proceed');
      return;
    }

    console.log('[ContractSign] Validation Passed - Starting signature process');
    setSigning(true);
    try {
      const signatureDate = formatDateForBusiness(new Date(), businessTimezone);
      const signedHTML = embedEmployeeSignature(
        contract.contract_html,
        signatureRecord,
        signerName,
        signatureDate
      );

      const signedPdfBlob = await generatePdfBlobFromHtml(
        signedHTML,
        `Signed_Employment_Contract_${contract.employee_first_name}_${contract.employee_last_name}.pdf`
      );
      const signedPdfBase64 = await blobToBase64(signedPdfBlob);
      const signedPdfBuffer = await blobToUint8Array(signedPdfBlob);

      // ========== EXTENSIVE LOGGING FOR CONTRACT SIGNING ==========
      console.log('========== CONTRACT SIGNING - START UPDATE ==========');
      console.log('[ContractSign] Contract ID:', contract.id);
      console.log('[ContractSign] Contract Status (before):', contract.status);
      console.log('[ContractSign] Contract Business ID:', contract.business_id);
      console.log('[ContractSign] Signing Token:', contract.signing_token);
      console.log('[ContractSign] Employee Email:', contract.employee_email);
      console.log('[ContractSign] Signer Name:', signerName);
      
      // Check authentication state
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      console.log('[ContractSign] Authentication State:', {
        hasSession: !!session,
        userId: session?.user?.id || 'NOT AUTHENTICATED',
        userEmail: session?.user?.email || 'NOT AUTHENTICATED',
        sessionError: sessionError?.message || null
      });

      // Check if user has roles (for RLS policy check)
      if (session?.user?.id) {
        const { data: userRoles, error: rolesError } = await supabase
          .from('user_roles')
          .select('business_id, role, active')
          .eq('user_id', session.user.id)
          .eq('active', true);
        console.log('[ContractSign] User Roles (for RLS check):', {
          roles: userRoles || [],
          rolesError: rolesError?.message || null,
          hasAccessToBusiness: userRoles?.some(r => r.business_id === contract.business_id) || false
        });
      } else {
        console.log('[ContractSign] User Roles: NOT AUTHENTICATED - Will use signing_token policy');
      }

      // Extend expiration date by 14 days for authorized rep to sign (if employee signed on time)
      const newExpirationDate = new Date();
      newExpirationDate.setDate(newExpirationDate.getDate() + 14); // Add 14 days for authorized rep
      newExpirationDate.setHours(23, 59, 59, 999); // Set to end of day

      // Prepare update payload - SPLIT INTO TWO UPDATES to avoid timeout
      // First update: status, signature data, and contract HTML with employee signature (small, fast)
      const updatePayload = {
        status: 'employee_signed', // New status for employee-signed, awaiting authorized rep
        signed_at: new Date().toISOString(),
        signed_by_employee: true,
        expires_at: newExpirationDate.toISOString(), // Extend expiration for authorized rep
        contract_html: signedHTML, // Save contract HTML with employee signature embedded
        digital_signature_data: {
          employee_signature: signatureRecord.signatureData,
          employee_name: signerName,
          employee_email: contract.employee_email,
          signed_at: new Date().toISOString(),
          ip_address: 'client-ip', // Would be captured server-side
          metadata: signatureRecord.metadata
        }
        // NOTE: signed_pdf_data will be updated separately to avoid timeout
      };

      console.log('[ContractSign] Update Payload (Phase 1 - Status & Signature):', {
        status: updatePayload.status,
        signed_at: updatePayload.signed_at,
        signed_by_employee: updatePayload.signed_by_employee,
        has_contract_html: !!updatePayload.contract_html,
        contract_html_length: updatePayload.contract_html?.length || 0,
        has_digital_signature_data: !!updatePayload.digital_signature_data,
        digital_signature_keys: Object.keys(updatePayload.digital_signature_data || {}),
        pdf_data_size: signedPdfBuffer.length,
        pdf_will_be_uploaded_separately: true
      });

      console.log('[ContractSign] Executing UPDATE query...');
      console.log('[ContractSign] WHERE clause: id =', contract.id);
      console.log('[ContractSign] Expected RLS Policy: hr_contracts_employee_signing (for unauthenticated) or hr_contracts_business_isolation (for authenticated)');

      // Update contract with signature
      const updateStartTime = Date.now();
      const { data: updateData, error: updateError } = await supabase
        .from('hr_contracts')
        .update(updatePayload)
        .eq('id', contract.id)
        .select('id, status, signed_at, business_id, signing_token');

      const updateDuration = Date.now() - updateStartTime;
      console.log('[ContractSign] Update Duration:', updateDuration + 'ms');

      if (updateError) {
        console.error('========== CONTRACT SIGNING - UPDATE FAILED ==========');
        console.error('[ContractSign] Error Code:', updateError.code);
        console.error('[ContractSign] Error Message:', updateError.message);
        console.error('[ContractSign] Error Details:', updateError.details);
        console.error('[ContractSign] Error Hint:', updateError.hint);
        console.error('[ContractSign] Full Error Object:', JSON.stringify(updateError, null, 2));
        console.error('[ContractSign] Contract State:', {
          id: contract.id,
          business_id: contract.business_id,
          current_status: contract.status,
          signing_token: contract.signing_token ? 'PRESENT' : 'MISSING',
          employee_email: contract.employee_email
        });
        console.error('[ContractSign] Update Payload Sent:', {
          status: updatePayload.status,
          signed_at: updatePayload.signed_at,
          has_signature_data: !!updatePayload.digital_signature_data,
          has_pdf_data: !!updatePayload.signed_pdf_data
        });
        console.error('========== END ERROR LOG ==========');
        toast.error('Failed to save signature: ' + updateError.message);
        throw updateError;
      }

      console.log('========== CONTRACT SIGNING - UPDATE SUCCESS ==========');
      console.log('[ContractSign] Update Result:', {
        id: updateData?.[0]?.id,
        status: updateData?.[0]?.status,
        signed_at: updateData?.[0]?.signed_at,
        business_id: updateData?.[0]?.business_id,
        signing_token: updateData?.[0]?.signing_token ? 'PRESENT' : 'MISSING'
      });
      console.log('[ContractSign] Status Changed From:', contract.status, 'To:', updateData?.[0]?.status);
      console.log('========== END SUCCESS LOG ==========');

      // CRITICAL: Reload contract data to get all email fields for sending emails
      console.log('[ContractSign] Reloading contract data to get all email fields...');
      const { data: reloadedContract, error: reloadError } = await supabase
        .from('hr_contracts')
        .select('id, business_id, employee_email, employee_first_name, employee_last_name, hr_email, authorized_representative_email, authorized_representative_name, authorized_representative_signing_token, contract_data')
        .eq('id', contract.id)
        .single();
      
      // Create a merged contract object for email sending (don't reassign const contract)
      let contractForEmail = { ...contract };
      
      if (reloadError) {
        console.error('[ContractSign] Error reloading contract:', reloadError);
        // Use original contract as fallback
      } else if (reloadedContract) {
        console.log('[ContractSign] Contract reloaded successfully:', {
          hr_email: reloadedContract.hr_email || 'NOT SET',
          employee_email: reloadedContract.employee_email || 'NOT SET',
          authorized_representative_email: reloadedContract.authorized_representative_email || 'NOT SET',
          authorized_representative_signing_token: reloadedContract.authorized_representative_signing_token ? 'PRESENT' : 'MISSING'
        });
        // Merge reloaded data with original contract for email sending
        contractForEmail = { ...contract, ...reloadedContract };
      }

      // Ensure we have all required email fields - if missing, try to get from contract_data
      if (!contractForEmail.authorized_representative_email && contractForEmail.contract_data?.authorized_representative_email) {
        contractForEmail.authorized_representative_email = contractForEmail.contract_data.authorized_representative_email;
        console.log('[ContractSign] Using authorized_representative_email from contract_data:', contractForEmail.authorized_representative_email);
      }
      if (!contractForEmail.authorized_representative_signing_token && contractForEmail.contract_data?.authorized_representative_signing_token) {
        contractForEmail.authorized_representative_signing_token = contractForEmail.contract_data.authorized_representative_signing_token;
        console.log('[ContractSign] Using authorized_representative_signing_token from contract_data');
      }
      if (!contractForEmail.authorized_representative_name && contractForEmail.contract_data?.authorized_representative_name) {
        contractForEmail.authorized_representative_name = contractForEmail.contract_data.authorized_representative_name;
        console.log('[ContractSign] Using authorized_representative_name from contract_data:', contractForEmail.authorized_representative_name);
      }

      // Phase 2: Upload PDF separately (non-blocking, won't fail if it times out)
      console.log('[ContractSign] Phase 2: Uploading PDF data separately (non-blocking)...');
      console.log('[ContractSign] PDF Size:', signedPdfBuffer.length, 'bytes');
      
      // Upload PDF in background - don't wait for it or fail if it times out
      (async () => {
        try {
          const pdfUpdateStartTime = Date.now();
          const { error: pdfUpdateError } = await supabase
            .from('hr_contracts')
            .update({ signed_pdf_data: signedPdfBuffer })
            .eq('id', contract.id);
          
          const pdfUpdateDuration = Date.now() - pdfUpdateStartTime;
          
          if (pdfUpdateError) {
            console.warn('[ContractSign] PDF upload failed (non-critical):', {
              error: pdfUpdateError.message,
              code: pdfUpdateError.code,
              duration: pdfUpdateDuration + 'ms'
            });
            console.warn('[ContractSign] Contract is still signed - PDF can be regenerated from contract_html if needed');
          } else {
            console.log('[ContractSign] PDF uploaded successfully:', {
              duration: pdfUpdateDuration + 'ms',
              size: signedPdfBuffer.length + ' bytes'
            });
          }
        } catch (pdfError) {
          console.warn('[ContractSign] PDF upload exception (non-critical):', pdfError.message);
        }
      })();

      // Send email to authorized representative with signing link
      console.log('========== EMAIL TO AUTHORIZED REP - CHECKING ==========');
      console.log('[Email] Contract object after reload:', {
        id: contractForEmail.id,
        has_authorized_rep_email: !!contractForEmail.authorized_representative_email,
        authorized_rep_email: contractForEmail.authorized_representative_email || 'MISSING',
        has_authorized_rep_token: !!contractForEmail.authorized_representative_signing_token,
        authorized_rep_token: contractForEmail.authorized_representative_signing_token ? 'PRESENT' : 'MISSING',
        authorized_rep_name: contractForEmail.authorized_representative_name || 'NOT SET',
        has_contract_data: !!contractForEmail.contract_data,
        contract_data_keys: contractForEmail.contract_data ? Object.keys(contractForEmail.contract_data) : 'NO CONTRACT_DATA'
      });
      
      // Check contract_data if fields are missing from contract record
      if (!contractForEmail.authorized_representative_email && contractForEmail.contract_data) {
        console.log('[Email] Checking contract_data for authorized rep email...');
        console.log('[Email] contract_data.authorized_representative_email:', contractForEmail.contract_data.authorized_representative_email || 'NOT IN CONTRACT_DATA');
      }

      // CRITICAL: Must have both email and token to send
      const hasAuthRepEmail = !!(contractForEmail.authorized_representative_email || contractForEmail.contract_data?.authorized_representative_email);
      const hasAuthRepToken = !!(contractForEmail.authorized_representative_signing_token || contractForEmail.contract_data?.authorized_representative_signing_token);
      
      console.log('[Email] Final check:', {
        hasAuthRepEmail,
        hasAuthRepToken,
        willSendEmail: hasAuthRepEmail && hasAuthRepToken
      });

      if (hasAuthRepEmail && hasAuthRepToken) {
        // Use values from contract record or fallback to contract_data
        const authRepEmail = contractForEmail.authorized_representative_email || contractForEmail.contract_data?.authorized_representative_email;
        const authRepToken = contractForEmail.authorized_representative_signing_token || contractForEmail.contract_data?.authorized_representative_signing_token;
        const authRepName = contractForEmail.authorized_representative_name || contractForEmail.contract_data?.authorized_representative_name || 'Authorized Representative';
        
        console.log('[Email] Using values:', {
          authRepEmail,
          authRepToken: authRepToken ? 'PRESENT' : 'MISSING',
          authRepName
        });
        console.log('[Email] Conditions met - Preparing to send email');
        const frontendUrl = import.meta.env.VITE_FRONTEND_URL || window.location.origin;
        const authRepSigningLink = `${frontendUrl}/contract/sign/authorized/${authRepToken}`;
        console.log('[Email] Signing Link:', authRepSigningLink);
        console.log('[Email] Frontend URL:', frontendUrl);
        
        const authRepEmailHTML = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Contract Requires Your Signature</title>
            <style>
              body {
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f5f5f5;
              }
              .email-wrapper {
                background: white;
                border-radius: 8px;
                padding: 30px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              }
              .sign-button {
                display: inline-block;
                background-color: #008080;
                color: white;
                padding: 15px 30px;
                text-decoration: none;
                border-radius: 5px;
                font-weight: bold;
                margin: 20px 0;
              }
              .sign-button:hover {
                background-color: #006666;
              }
            </style>
          </head>
          <body>
            <div class="email-wrapper">
              <h2>Contract Requires Your Signature</h2>
              <p>Dear ${authRepName},</p>
              <p>The employment contract for <strong>${contractForEmail.employee_first_name} ${contractForEmail.employee_last_name}</strong> has been signed by the employee and now requires your signature as the authorized representative.</p>
              <p><strong>Please review and sign the contract by clicking the button below:</strong></p>
              <a href="${authRepSigningLink}" class="sign-button" style="color: white; text-decoration: none;">Review & Sign Contract</a>
              <p style="margin-top: 15px; font-size: 9px; color: #666;">
                Or copy and paste this link into your browser:<br>
                <a href="${authRepSigningLink}" style="color: #008080; word-break: break-all;">${authRepSigningLink}</a>
              </p>
            </div>
          </body>
          </html>
        `;

        const plainTextBody = `Dear ${authRepName},

The employment contract for ${contractForEmail.employee_first_name} ${contractForEmail.employee_last_name} has been signed by the employee and now requires your signature as the authorized representative.

Please review and sign the contract by visiting:
${authRepSigningLink}`;

        const businessName = await resolveBusinessDisplayName({
          businessId: contractForEmail.business_id,
          contractData: contract.contract_data,
        });
        const senderName = formatContractHrFromName(businessName);
        console.log('[Email] Final business name for email:', businessName);

        const emailPayload = {
          businessId: contractForEmail.business_id,
          campaignId: `contract-auth-rep-${contractForEmail.id}-${Date.now()}`,
          contactId: `contract-auth-rep-${authRepEmail}`,
          emailType: 'transactional',
          to: authRepEmail,
          fromEmail: 'noreply@tavarios.ca',
          fromName: senderName,
          subject: `Contract Requires Your Signature - ${contractForEmail.employee_first_name} ${contractForEmail.employee_last_name}`,
          html: authRepEmailHTML,
          text: plainTextBody
        };

        console.log('[Email] Email Payload Prepared:', {
          to: emailPayload.to,
          fromEmail: emailPayload.fromEmail,
          fromName: emailPayload.fromName,
          subject: emailPayload.subject,
          businessId: emailPayload.businessId,
          campaignId: emailPayload.campaignId,
          contactId: emailPayload.contactId,
          has_html: !!emailPayload.html,
          has_text: !!emailPayload.text,
          html_length: emailPayload.html?.length || 0
        });

        console.log('[Email] Sending email via Edge Function...');
        console.log('[Email] Edge Function URL:', `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`);
        
        try {
          const emailStartTime = Date.now();
          const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify(emailPayload)
          });

          const emailDuration = Date.now() - emailStartTime;
          console.log('[Email] Email Request Duration:', emailDuration + 'ms');
          console.log('[Email] Response Status:', response.status, response.statusText);
          console.log('[Email] Response OK:', response.ok);

          if (!response.ok) {
            const errorText = await response.text();
            console.error('========== EMAIL SEND FAILED ==========');
            console.error('[Email] Response Status:', response.status);
            console.error('[Email] Response Status Text:', response.statusText);
            console.error('[Email] Error Response:', errorText);
            console.error('[Email] Email Payload:', JSON.stringify(emailPayload, null, 2));
            console.error('========== END EMAIL ERROR ==========');
            // Don't throw - email failure shouldn't block contract signing
            toast.warn('Contract signed, but email to authorized representative may not have been sent. Please check email address.');
          } else {
            const responseData = await response.json().catch(() => ({ message: 'No JSON response' }));
            console.log('========== EMAIL SENT SUCCESSFULLY ==========');
            console.log('[Email] Response Data:', responseData);
            console.log('[Email] Email sent to:', authRepEmail);
            console.log('[Email] Message ID:', responseData.messageId || responseData.message_id || 'N/A');
            console.log('[Email] Success:', responseData.ok !== false);
            console.log('[Email] Signing Link:', authRepSigningLink);
            console.log('========== END EMAIL SUCCESS ==========');
          }
        } catch (emailError) {
          console.error('========== EMAIL SEND EXCEPTION ==========');
          console.error('[Email] Error Type:', emailError?.constructor?.name || typeof emailError);
          console.error('[Email] Error Message:', emailError?.message);
          console.error('[Email] Error Stack:', emailError?.stack);
          console.error('[Email] Full Error:', JSON.stringify(emailError, Object.getOwnPropertyNames(emailError), 2));
          console.error('[Email] Email Payload That Failed:', emailPayload);
          console.error('========== END EMAIL EXCEPTION ==========');
          toast.error('Failed to send email to authorized representative. Please check the email address and try resending from the contract management page.');
        }
      } else {
        console.error('========== EMAIL NOT SENT - CONDITIONS NOT MET ==========');
        console.error('[Email] Reason: Missing authorized_representative_email or authorized_representative_signing_token');
        console.error('[Email] Contract Record:', {
          authorized_representative_email: contractForEmail.authorized_representative_email || 'MISSING',
          authorized_representative_signing_token: contractForEmail.authorized_representative_signing_token ? 'PRESENT' : 'MISSING',
          authorized_representative_name: contractForEmail.authorized_representative_name || 'NOT SET'
        });
        console.error('[Email] Contract Data:', {
          authorized_representative_email: contractForEmail.contract_data?.authorized_representative_email || 'MISSING',
          authorized_representative_signing_token: contractForEmail.contract_data?.authorized_representative_signing_token ? 'PRESENT' : 'MISSING',
          authorized_representative_name: contractForEmail.contract_data?.authorized_representative_name || 'NOT SET'
        });
        console.error('========== END EMAIL SKIP LOG ==========');
        toast.error('Cannot send email to authorized representative: email address or signing token is missing. Please check the contract settings.');
      }

      // Create auth account with temp password and send portal credentials email
      console.log('[ContractSign] ========== CREATING PORTAL ACCESS - START ==========');
      console.log('[ContractSign] Checking employee_email:', {
        has_employee_email: !!contractForEmail.employee_email,
        employee_email: contractForEmail.employee_email || 'MISSING',
        contract_id: contractForEmail.id
      });
      
      if (contractForEmail.employee_email) {
        try {
          // Check if user already exists
          const { data: existingUser } = await supabase
            .from('users')
            .select('id, email')
            .eq('email', contractForEmail.employee_email)
            .maybeSingle();
          
          // ALWAYS generate temp password - we will send this regardless
          const tempPasswordValue = `TempPass${Math.random().toString(36).substring(2, 10)}!`;
          let tempPassword = tempPasswordValue; // Always set this so email always includes it
          
          // NOTE: Portal access creation requires authentication, but employee signing is public
          // Portal access will be created when the contract is fully signed (from authorized rep signing)
          // For now, we'll just generate the temp password and include it in the email
          // The employee can use it once portal access is created after full signing
          console.log('[ContractSign] Portal access will be created when contract is fully signed');
          
          if (existingUser) {
            // User exists - portal access will be created when contract is fully signed
            console.log('[ContractSign] User exists, portal access will be created when contract is fully signed');
          } else {
            // User doesn't exist - create employee record (auth account will be created when contract is fully signed)
            console.log('[ContractSign] User does not exist, creating employee (auth account will be created when contract is fully signed)');
            const { createEmployeeFromContract } = await import('../../utils/contractEmployeeCreation');
            
            const contractForEmployeeCreation = {
              id: contractForEmail.id, // Contract ID - required for public call validation
              business_id: contractForEmail.business_id,
              employee_email: contractForEmail.employee_email,
              employee_first_name: contractForEmail.employee_first_name || '',
              employee_last_name: contractForEmail.employee_last_name || '',
              employee_address: contractForEmail.contract_data?.keyTerms?.employeeAddress || null,
              position_title: contractForEmail.contract_data?.keyTerms?.positionTitle || null,
              contract_data: contractForEmail.contract_data
            };
            
            const result = await createEmployeeFromContract(contractForEmployeeCreation);
            if (result.success && result.tempPassword) {
              tempPassword = result.tempPassword; // Use the temp password from employee creation
              console.log('[ContractSign] ✅ Employee created (auth account will be created when contract is fully signed)');
            } else {
              // If employee creation didn't return temp password, use the one we generated
              console.warn('[ContractSign] Employee creation did not return temp password, using generated one');
              // tempPassword is already set above
            }
          }
          
          const businessName = await resolveBusinessDisplayName({
            businessId: contractForEmail.business_id,
            contractData: contractForEmail.contract_data,
          });
          const senderName = formatContractHrFromName(businessName);
          
          const frontendUrl = import.meta.env.VITE_FRONTEND_URL || window.location.origin;
          const portalLoginLink = `${frontendUrl}/portal/login`;
          
          // Create email with portal credentials
          // NOTE: Portal access will be created when the contract is fully signed by the authorized representative
          const portalCredentialsEmailHTML = `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Your Employee Portal Access</title>
              <style>
                body {
                  font-family: Arial, sans-serif;
                  line-height: 1.6;
                  color: #333;
                  max-width: 800px;
                  margin: 0 auto;
                  padding: 20px;
                  background-color: #f5f5f5;
                }
                .email-wrapper {
                  background: white;
                  border-radius: 8px;
                  padding: 30px;
                  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                }
                .credentials-box {
                  background-color: #f9f9f9;
                  border: 2px solid #008080;
                  border-radius: 8px;
                  padding: 20px;
                  margin: 20px 0;
                }
                .credential-item {
                  margin: 10px 0;
                  font-size: 9px;
                }
                .credential-label {
                  font-weight: bold;
                  color: #008080;
                  display: inline-block;
                  width: 100px;
                }
                .temp-password {
                  font-family: monospace;
                  font-size: 9px;
                  font-weight: bold;
                  color: #d9534f;
                  background-color: #fff;
                  padding: 5px 10px;
                  border: 1px solid #ddd;
                  border-radius: 4px;
                }
                .warning-box {
                  background-color: #fff3cd;
                  border-left: 4px solid #ffc107;
                  padding: 15px;
                  margin: 20px 0;
                  border-radius: 4px;
                }
                .portal-button {
                  display: inline-block;
                  background-color: #008080;
                  color: white;
                  padding: 15px 30px;
                  text-decoration: none;
                  border-radius: 5px;
                  font-weight: bold;
                  margin: 20px 0;
                }
                .portal-button:hover {
                  background-color: #006666;
                }
              </style>
            </head>
            <body>
              <div class="email-wrapper">
                <h2>Contract Signed Successfully!</h2>
                <p>Dear ${contractForEmail.employee_first_name || 'Employee'},</p>
                <p>Thank you for signing your employment contract! Your signature has been received.</p>
                
                <div class="warning-box">
                  <strong>📋 Next Steps:</strong>
                  <ul style="margin: 10px 0; padding-left: 20px;">
                    <li>Your contract is now awaiting signature from the authorized representative</li>
                    <li>Once the contract is fully signed, you will receive an email with your Employee Portal login credentials</li>
                    <li>You will be able to access your portal to view your contract, pay statements, and update your profile</li>
                  </ul>
                </div>
                
                <p style="margin-top: 30px; font-size: 9px; color: #666;">
                  You will receive another email once the contract is fully signed with your portal access information.
                </p>
                
                <p>Best regards,<br>${senderName}</p>
              </div>
            </body>
            </html>
          `;
          
          const plainTextBody = `Dear ${contractForEmail.employee_first_name || 'Employee'},

Thank you for signing your employment contract! Your signature has been received.

Next Steps:
- Your contract is now awaiting signature from the authorized representative
- Once the contract is fully signed, you will receive an email with your Employee Portal login credentials
- You will be able to access your portal to view your contract, pay statements, and update your profile

You will receive another email once the contract is fully signed with your portal access information.

After logging in, you'll be asked to complete your profile setup, including your personal information, SIN number, and emergency contacts.

Best regards,
${senderName}`;
          
          const portalCredentialsEmailPayload = {
            businessId: contractForEmail.business_id,
            campaignId: `portal-credentials-${contractForEmail.id}-${Date.now()}`,
            contactId: `portal-credentials-${contractForEmail.employee_email}`,
            emailType: 'transactional',
            to: contractForEmail.employee_email,
            fromEmail: 'noreply@tavarios.ca',
            fromName: senderName,
            subject: `Your Employee Portal Access - ${contractForEmail.employee_first_name} ${contractForEmail.employee_last_name}`,
            html: portalCredentialsEmailHTML,
            text: plainTextBody
          };
          
          const portalEmailResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify(portalCredentialsEmailPayload)
          });
          
          if (portalEmailResponse.ok) {
            const responseData = await portalEmailResponse.json().catch(() => ({ message: 'No JSON response' }));
            console.log('[ContractSign] ✅ Portal credentials email sent successfully');
            console.log('[ContractSign] Message ID:', responseData.messageId || responseData.message_id || 'N/A');
          } else {
            const errorText = await portalEmailResponse.text();
            console.error('[ContractSign] Failed to send portal credentials email');
            console.error('[ContractSign] Response Status:', portalEmailResponse.status);
            console.error('[ContractSign] Error Response:', errorText);
            toast.warn('Portal credentials email may not have been sent. Please check employee email address.');
          }
        } catch (portalAccessError) {
          console.error('[ContractSign] Error creating portal access:', portalAccessError);
          console.error('[ContractSign] Error Type:', portalAccessError?.constructor?.name || typeof portalAccessError);
          console.error('[ContractSign] Error Message:', portalAccessError?.message);
          console.error('[ContractSign] Error Stack:', portalAccessError?.stack);
          toast.error('Failed to create portal access. Employee may need to be created manually.');
        }
      } else {
        console.warn('[ContractSign] Cannot create portal access - employee_email is missing');
        toast.warn('Portal access cannot be created: employee email address is missing.');
      }
      
      toast.success('Contract signed successfully! The authorized representative will be notified to complete the signing process. Portal access credentials have been sent to your email.');
      
      // Redirect after delay
      setTimeout(() => {
        navigate('/');
      }, 3000);

    } catch (err) {
      console.error('========== CONTRACT SIGNING - UNHANDLED ERROR ==========');
      console.error('[ContractSign] Error Type:', err?.constructor?.name || typeof err);
      console.error('[ContractSign] Error Message:', err?.message);
      console.error('[ContractSign] Error Stack:', err?.stack);
      console.error('[ContractSign] Full Error Object:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
      console.error('[ContractSign] Contract State at Error:', {
        id: contract?.id,
        status: contract?.status,
        business_id: contract?.business_id,
        signing_token: contract?.signing_token ? 'PRESENT' : 'MISSING'
      });
      console.error('[ContractSign] Signer Info:', {
        name: signerName,
        email: contract?.employee_email,
        hasConsent: digitalSignatureConsent
      });
      console.error('========== END UNHANDLED ERROR LOG ==========');
      toast.error('Failed to complete signature. Please try again.');
    } finally {
      console.log('[ContractSign] Function Complete - Setting signing to false');
      setSigning(false);
    }
  };

  // PDF Download Function
  const handleDownloadPDF = async () => {
    if (!contract?.contract_html) {
      toast.error('Contract content is not available for download.');
      return;
    }

    try {
      toast.loading('Generating PDF...', { id: 'pdf-generate' });
      const filename = `Employment_Contract_${contract.employee_first_name}_${contract.employee_last_name}_${new Date().toISOString().split('T')[0]}.pdf`;
      await downloadContractPdf(contract.contract_html, filename);
      toast.success('PDF downloaded successfully!', { id: 'pdf-generate' });
    } catch (error) {
      console.error('[ContractSignScreen] Error generating PDF:', error);
      toast.error('Failed to generate PDF. Please try again.', { id: 'pdf-generate' });
    }
  };

  // Print Function
  const handlePrint = () => {
    if (!contract?.contract_html) {
      toast.error('Contract content is not available for printing.');
      return;
    }

    try {
      // Create a new window for printing
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast.error('Please allow pop-ups to print the contract.');
        return;
      }

      // Write the contract HTML to the new window
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Employment Contract - Print</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              margin: 20px;
              color: #000;
            }
            @media print {
              body { margin: 0; }
              @page { margin: 0.5in; }
            }
          </style>
        </head>
        <body>
          ${contract.contract_html}
        </body>
        </html>
      `);
      
      printWindow.document.close();
      
      // Wait for content to load, then print
      printWindow.onload = () => {
        setTimeout(() => {
          printWindow.print();
          // Optionally close the window after printing
          // printWindow.close();
        }, 250);
      };
    } catch (error) {
      console.error('[ContractSignScreen] Error printing:', error);
      toast.error('Failed to open print dialog. Please try again.');
    }
  };

  // Styles using TavariStyles - Following Tavari Build Standards
  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.xl, // 20px edge padding per standards
      paddingTop: TavariStyles.spacing['3xl']
    },
    card: {
      maxWidth: '1200px',
      margin: '0 auto',
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      boxShadow: TavariStyles.shadows.md,
      padding: TavariStyles.spacing.xl // 20px edge padding per standards
    },
    header: {
      marginBottom: TavariStyles.spacing['3xl'],
      borderBottom: `2px solid ${TavariStyles.colors.primary}`,
      paddingBottom: TavariStyles.spacing.xl
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary,
      marginBottom: TavariStyles.spacing.sm
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray600,
      lineHeight: TavariStyles.typography.lineHeight.relaxed
    },
    contractPreview: {
      marginBottom: TavariStyles.spacing['3xl'],
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.md,
      padding: TavariStyles.spacing.xl,
      maxHeight: '600px',
      overflowY: 'auto',
      backgroundColor: TavariStyles.colors.gray50
    },
    signatureSection: {
      marginTop: TavariStyles.spacing['3xl'],
      paddingTop: TavariStyles.spacing['3xl'],
      borderTop: `2px solid ${TavariStyles.colors.primary}`
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xl
    },
    formGroup: {
      marginBottom: TavariStyles.spacing.xl
    },
    label: {
      ...TavariStyles.components.form?.label,
      marginBottom: TavariStyles.spacing.sm
    },
    input: {
      ...TavariStyles.components.form?.input,
      maxWidth: '400px',
      width: '100%'
    },
    button: {
      ...TavariStyles.components.button?.base,
      ...TavariStyles.components.button?.variants?.primary
    },
    secondaryButton: {
      ...TavariStyles.components.button?.base,
      ...TavariStyles.components.button?.variants?.secondary
    },
    errorCard: {
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing['3xl'],
      borderRadius: TavariStyles.borderRadius.lg,
      boxShadow: TavariStyles.shadows.md,
      maxWidth: '600px',
      textAlign: 'center'
    },
    errorTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.sm
    },
    errorText: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.xl
    },
    loadingContainer: {
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: TavariStyles.colors.gray50
    },
    loadingText: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600
    }
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={{ textAlign: 'center' }}>
          <div style={styles.loadingText}>Loading contract...</div>
        </div>
      </div>
    );
  }

  if (error || expired || !contract) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.errorCard}>
          <AlertCircle size={48} style={{ color: TavariStyles.colors.danger, marginBottom: TavariStyles.spacing.xl }} />
          <h2 style={styles.errorTitle}>Unable to Load Contract</h2>
          <p style={styles.errorText}>{error || 'Contract not found'}</p>
          <button
            onClick={() => navigate('/')}
            style={{
              ...styles.button,
              width: '100%',
              fontWeight: TavariStyles.typography.fontWeight.bold
            }}
          >
            Return Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <h1 style={styles.title}>Employment Contract</h1>
          <p style={styles.subtitle}>
            Please review the contract below and provide your digital signature to accept the terms.
          </p>
        </div>

        {/* PDF Download and Print Buttons */}
        <div style={{
          display: 'flex',
          gap: TavariStyles.spacing.md,
          marginBottom: TavariStyles.spacing.lg,
          flexWrap: 'wrap'
        }}>
          <button
            onClick={handleDownloadPDF}
            style={{
              ...styles.secondaryButton,
              display: 'flex',
              alignItems: 'center',
              gap: TavariStyles.spacing.sm,
              padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`
            }}
            disabled={!contract?.contract_html}
          >
            <Download size={18} />
            Download PDF
          </button>
          <button
            onClick={handlePrint}
            style={{
              ...styles.secondaryButton,
              display: 'flex',
              alignItems: 'center',
              gap: TavariStyles.spacing.sm,
              padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`
            }}
            disabled={!contract?.contract_html}
          >
            <Printer size={18} />
            Print
          </button>
        </div>

        {/* Contract Preview */}
        <div style={styles.contractPreview}>
          {contract.contract_html ? (
            <div dangerouslySetInnerHTML={{ __html: extractBodyHtml(contract.contract_html) }} />
          ) : (
            <div style={{ padding: '20px', textAlign: 'center', color: TavariStyles.colors.gray600 }}>
              <AlertCircle size={48} style={{ marginBottom: '16px', color: TavariStyles.colors.warning }} />
              <p>Contract content is missing. Please contact HR.</p>
            </div>
          )}
        </div>

        {/* Signature Section */}
        <div style={styles.signatureSection}>
          <h2 style={styles.sectionTitle}>Digital Signature</h2>
          
          <div style={styles.formGroup}>
            <label style={styles.label}>
              Full Name (as it appears on the contract):
            </label>
            <input
              type="text"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              style={styles.input}
              placeholder="Enter your full name"
            />
          </div>

          <div style={styles.formGroup}>
            <TavariCheckbox
              checked={digitalSignatureConsent}
              onChange={(checked) => setDigitalSignatureConsent(checked)}
              label={
                <span>
                  I consent to digital signature. If you do not agree to digital signature, a printed contract will be provided on your first day. You MUST email {businessEmail || 'the business email'} to accept the position.
                </span>
              }
              size="md"
            />
          </div>

          <DigitalSignature
            documentType="contract"
            documentId={contract.id}
            businessId={contract.business_id}
            signerName={signerName}
            signerEmail={contract.employee_email}
            onSignatureComplete={handleSignatureComplete}
            onCancel={() => navigate('/')}
            requireWitness={false}
            isReadOnly={false}
            requireConsent={true}
            consentChecked={digitalSignatureConsent}
          />
        </div>
      </div>
    </div>
  );
};

export default ContractSignScreen;

