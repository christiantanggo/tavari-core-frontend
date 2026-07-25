// Authorized Representative Signing Screen - Public route for authorized representatives to sign contracts
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { CheckCircle, AlertCircle, X, FileText, Download, Printer } from 'lucide-react';
import DigitalSignature from '../../components/HR/DigitalSignature';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import toast from 'react-hot-toast';
import { TavariStyles } from '../../utils/TavariStyles';
import { createEmployeeFromContract } from '../../utils/contractEmployeeCreation';
import {
  formatContractHrFromName,
  resolveBusinessDisplayName,
} from '../../utils/contractPersistence';
import { syncEmployeeLifecycleFromSignedContract } from '../../utils/employeeContractContext';
import {
  blobToBase64,
  blobToUint8Array,
  embedAuthorizedRepSignature,
  ensureContractHtml,
  extractBodyHtml,
  generatePdfBlobFromHtml,
} from '../../utils/contractHtmlUtils';
import { downloadContractPdf } from '../../utils/contractPdf';

const AuthorizedRepSignScreen = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const [contract, setContract] = useState(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [digitalSignatureConsent, setDigitalSignatureConsent] = useState(false);

  useEffect(() => {
    loadContract();
  }, [token]);

  const loadContract = async () => {
    try {
      console.log('[AuthRepLoad] ========== LOADING CONTRACT ==========');
      console.log('[AuthRepLoad] Token:', token);
      console.log('[AuthRepLoad] Timestamp:', new Date().toISOString());
      setLoading(true);
      setError('');

      // Load contract by authorized representative signing token
      // Only select needed columns to reduce Disk IO (exclude large pdf_data unless needed)
      console.log('[AuthRepLoad] Executing query for authorized rep contract...');
      const { data, error: contractError } = await supabase
        .from('hr_contracts')
        .select('id, business_id, employee_email, employee_first_name, employee_last_name, contract_data, contract_html, signing_token, authorized_representative_signing_token, status, expires_at, signed_at, authorized_representative_name, authorized_representative_email, authorized_representative_signed_at, hr_email, digital_signature_data, signed_pdf_data')
        .eq('authorized_representative_signing_token', token)
        .maybeSingle();
      
      console.log('[AuthRepLoad] Query result:', {
        has_data: !!data,
        has_error: !!contractError,
        error_message: contractError?.message,
        contract_id: data?.id,
        hr_email: data?.hr_email || 'NOT SET',
        employee_email: data?.employee_email || 'NOT SET',
        status: data?.status
      });

      if (contractError) {
        console.error('[AuthRepLoad] Error loading contract:', contractError);
        setError('Failed to load contract: ' + contractError.message);
        setLoading(false);
        return;
      }

      if (!data) {
        console.error('[AuthRepLoad] Contract not found');
        setError('Contract not found. The link may be invalid or expired.');
        setLoading(false);
        return;
      }
      
      console.log('[AuthRepLoad] Contract loaded successfully:', {
        id: data.id,
        hr_email: data.hr_email || 'NOT SET',
        employee_email: data.employee_email || 'NOT SET',
        status: data.status
      });

      // Check if contract is expired - but allow if employee signed on time
      // If employee signed, the expiration was extended, so we should allow signing
      if (data.expires_at && new Date(data.expires_at) < new Date()) {
        // Only block if employee hasn't signed yet
        if (data.status !== 'employee_signed' && !data.signed_at) {
          setExpired(true);
          setError('This contract offer has expired.');
          setLoading(false);
          return;
        }
        // If employee signed on time, expiration was extended - allow authorized rep to sign
        console.log('[AuthRepLoad] Contract expired but employee signed on time - allowing authorized rep signature');
      }

      // Check if employee has signed
      if (data.status !== 'employee_signed' && data.status !== 'sent') {
        if (data.status === 'signed') {
          setError('This contract has already been fully signed.');
        } else {
          setError('The employee must sign the contract before you can sign it.');
        }
        setLoading(false);
        return;
      }

      // Check if already signed by authorized rep
      if (data.authorized_representative_signed_at) {
        setError('This contract has already been signed by the authorized representative.');
        setLoading(false);
        return;
      }

      let contractHtml = data.contract_html || '';
      try {
        contractHtml = await ensureContractHtml(supabase, data);
      } catch (regenErr) {
        console.warn('[AuthRepLoad] Could not regenerate contract HTML:', regenErr);
      }

      setContract({ ...data, contract_html: contractHtml });

      // Pre-fill signer name from contract
      setSignerName(data.authorized_representative_name || '');

      setLoading(false);
    } catch (err) {
      console.error('Error loading contract:', err);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  const handleSignatureComplete = async (signatureRecord) => {
    console.log('========== AUTHORIZED REP SIGNATURE COMPLETE - FUNCTION CALLED ==========');
    console.log('[AuthRepSign] Function Entry:', {
      hasContract: !!contract,
      contractId: contract?.id,
      signerName: signerName,
      hasSignatureRecord: !!signatureRecord,
      hasConsent: digitalSignatureConsent,
      timestamp: new Date().toISOString()
    });

    if (!contract || !signerName.trim()) {
      console.error('[AuthRepSign] Validation Failed: Missing contract or signer name');
      toast.error('Please provide your name');
      return;
    }

    if (!digitalSignatureConsent) {
      console.error('[AuthRepSign] Validation Failed: Missing digital signature consent');
      toast.error('You must consent to digital signature to proceed');
      return;
    }

    console.log('[AuthRepSign] Validation Passed - Starting signature process');
    setSigning(true);
    try {
      let contractHTML = contract.contract_html || '';
      try {
        contractHTML = await ensureContractHtml(supabase, contract);
      } catch (regenErr) {
        console.warn('[AuthRepSign] ensureContractHtml before sign:', regenErr);
      }

      const signatureDate = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      const signedHTML = embedAuthorizedRepSignature(
        contractHTML,
        signatureRecord,
        signerName,
        signatureDate
      );

      const pdfFilename = `Fully_Signed_Employment_Contract_${contract.employee_first_name}_${contract.employee_last_name}.pdf`;
      const finalPdfBlob = await generatePdfBlobFromHtml(signedHTML, pdfFilename);
      const finalPdfBase64 = await blobToBase64(finalPdfBlob);
      const finalPdfBuffer = await blobToUint8Array(finalPdfBlob);

      // ========== EXTENSIVE LOGGING FOR AUTHORIZED REP SIGNING ==========
      console.log('========== AUTHORIZED REP SIGNING - START UPDATE ==========');
      console.log('[AuthRepSign] Contract ID:', contract.id);
      console.log('[AuthRepSign] Contract Status (before):', contract.status);
      console.log('[AuthRepSign] HR Email:', contract.hr_email || 'NOT SET');
      console.log('[AuthRepSign] Employee Email:', contract.employee_email);
      console.log('[AuthRepSign] Signer Name:', signerName);
      console.log('[AuthRepSign] PDF Size:', finalPdfBuffer.length, 'bytes');

      // Update contract with authorized representative signature - SPLIT INTO TWO UPDATES
      // Phase 1: Status and signature data (small, fast)
      const updatePayload = {
        status: 'signed', // Fully signed
        authorized_representative_signed_at: new Date().toISOString(),
        authorized_representative_signature_data: {
          signature: signatureRecord.signatureData,
          signer_name: signerName,
          signed_at: new Date().toISOString(),
          ip_address: 'client-ip',
          metadata: signatureRecord.metadata
        },
        contract_html: signedHTML
        // NOTE: signed_pdf_data will be updated separately to avoid timeout
      };

      console.log('[AuthRepSign] Update Payload (Phase 1):', {
        status: updatePayload.status,
        has_signature_data: !!updatePayload.authorized_representative_signature_data,
        has_contract_html: !!updatePayload.contract_html,
        pdf_will_be_uploaded_separately: true
      });

      console.log('[AuthRepSign] Executing Phase 1 UPDATE query...');
      const updateStartTime = Date.now();
      const { data: updateData, error: updateError } = await supabase
        .from('hr_contracts')
        .update(updatePayload)
        .eq('id', contract.id)
        .select('id, status, hr_email, employee_email');

      const updateDuration = Date.now() - updateStartTime;
      console.log('[AuthRepSign] Update Duration:', updateDuration + 'ms');

      if (updateError) {
        console.error('========== AUTHORIZED REP SIGNING - UPDATE FAILED ==========');
        console.error('[AuthRepSign] Error Code:', updateError.code);
        console.error('[AuthRepSign] Error Message:', updateError.message);
        console.error('[AuthRepSign] Error Details:', updateError.details);
        console.error('[AuthRepSign] Error Hint:', updateError.hint);
        console.error('========== END ERROR LOG ==========');
        toast.error('Failed to save signature: ' + updateError.message);
        throw updateError;
      }

      console.log('========== AUTHORIZED REP SIGNING - UPDATE SUCCESS ==========');
      console.log('[AuthRepSign] Update Result:', {
        id: updateData?.[0]?.id,
        status: updateData?.[0]?.status,
        hr_email: updateData?.[0]?.hr_email || 'NOT SET',
        employee_email: updateData?.[0]?.employee_email
      });
      console.log('[AuthRepSign] Status Changed From:', contract.status, 'To:', updateData?.[0]?.status);
      console.log('========== END SUCCESS LOG ==========');

      // CRITICAL: Reload contract data to get all email fields for sending emails
      console.log('[AuthRepSign] Reloading contract data to get all email fields...');
      const { data: reloadedContract, error: reloadError } = await supabase
        .from('hr_contracts')
        .select('id, business_id, employee_email, employee_first_name, employee_last_name, hr_email, authorized_representative_email, authorized_representative_name, contract_data, contract_html, signing_token, authorized_representative_signing_token')
        .eq('id', contract.id)
        .single();
      
      // Create a merged contract object for email sending (don't reassign const contract)
      let contractForEmail = { ...contract };
      
      if (reloadError) {
        console.error('[AuthRepSign] Error reloading contract:', reloadError);
        // Use original contract as fallback
      } else if (reloadedContract) {
        console.log('[AuthRepSign] Contract reloaded successfully:', {
          hr_email: reloadedContract.hr_email || 'NOT SET',
          employee_email: reloadedContract.employee_email || 'NOT SET',
          authorized_representative_email: reloadedContract.authorized_representative_email || 'NOT SET'
        });
        // Merge reloaded data with original contract for email sending
        contractForEmail = { ...contract, ...reloadedContract };
      }

      // Ensure we have all required email fields - if missing, try to get from contract_data
      // This is critical because emails might be NULL in the database columns but stored in contract_data
      if (!contractForEmail.hr_email || contractForEmail.hr_email.trim() === '') {
        const hrEmailFromData = contractForEmail.contract_data?.hr_email || 
                                contractForEmail.contract_data?.keyTerms?.hrEmail ||
                                contractForEmail.contract_data?.businessData?.hrEmail;
        if (hrEmailFromData) {
          contractForEmail.hr_email = hrEmailFromData;
          console.log('[AuthRepSign] Using hr_email from contract_data:', contractForEmail.hr_email);
        }
      }
      if (!contractForEmail.authorized_representative_email || contractForEmail.authorized_representative_email.trim() === '') {
        const authRepEmailFromData = contractForEmail.contract_data?.authorized_representative_email ||
                                    contractForEmail.contract_data?.keyTerms?.authorizedRepresentativeEmail;
        if (authRepEmailFromData) {
          contractForEmail.authorized_representative_email = authRepEmailFromData;
          console.log('[AuthRepSign] Using authorized_representative_email from contract_data:', contractForEmail.authorized_representative_email);
        }
      }
      if (!contractForEmail.employee_email || contractForEmail.employee_email.trim() === '') {
        const empEmailFromData = contractForEmail.contract_data?.employee_email ||
                                contractForEmail.contract_data?.keyTerms?.employeeEmail;
        if (empEmailFromData) {
          contractForEmail.employee_email = empEmailFromData;
          console.log('[AuthRepSign] Using employee_email from contract_data:', contractForEmail.employee_email);
        }
      }
      
      // Log final email status for debugging
      console.log('[AuthRepSign] Final email fields after fallback:', {
        hr_email: contractForEmail.hr_email || 'MISSING',
        authorized_representative_email: contractForEmail.authorized_representative_email || 'MISSING',
        employee_email: contractForEmail.employee_email || 'MISSING'
      });

      // CRITICAL: When contract is fully signed, ensure employee exists and is properly linked to business
      // This ensures both business_users and user_roles entries exist
      if (updateData?.[0]?.status === 'signed') {
        console.log('[AuthRepSign] Contract fully signed - ensuring employee exists and is linked to business...');
        console.log('[AuthRepSign] Contract data:', {
          employee_id: contract.employee_id,
          employee_email: contractForEmail.employee_email,
          business_id: contractForEmail.business_id
        });
        
        try {
          // Call createEmployeeFromContract to ensure employee exists and is properly linked
          // This function handles both new employees and existing employees
          // It also creates portal access and returns tempPassword if a new account was created
          const employeeCreationResult = await createEmployeeFromContract({
            id: contractForEmail.id,
            business_id: contractForEmail.business_id,
            employee_email: contractForEmail.employee_email,
            employee_first_name: contractForEmail.employee_first_name,
            employee_last_name: contractForEmail.employee_last_name,
            employee_address: contractForEmail.contract_data?.keyTerms?.employeeAddress || null,
            position_title: contractForEmail.contract_data?.keyTerms?.positionTitle || null,
            contract_data: contractForEmail.contract_data
          });
          
          if (employeeCreationResult.success) {
            console.log('[AuthRepSign] ✅ Employee verified/created and linked to business successfully');
            console.log('[AuthRepSign] Employee ID:', employeeCreationResult.employeeId);

            const employeeId =
              employeeCreationResult.employeeId || contract.employee_id || updateData?.[0]?.employee_id;
            if (employeeId) {
              const { data: signedContractRow } = await supabase
                .from('hr_contracts')
                .select(
                  'id, business_id, status, start_date, probation_end_date, contract_data, employment_status'
                )
                .eq('id', contract.id)
                .maybeSingle();
              if (signedContractRow) {
                await syncEmployeeLifecycleFromSignedContract(
                  { ...signedContractRow, status: 'signed' },
                  employeeId
                );
              }
            }

            // Skip portal access if employee is terminated
            if (employeeCreationResult.skippedPortalAccess) {
              console.log('[AuthRepSign] Portal access skipped - employee is terminated');
            }
            // If portal access was created (tempPassword returned), send portal credentials email
            else if (employeeCreationResult.tempPassword && contractForEmail.employee_email) {
              console.log('[AuthRepSign] Portal access created - sending credentials email');
              
              const businessName = await resolveBusinessDisplayName({
                businessId: contractForEmail.business_id,
                contractData: contractForEmail.contract_data,
              });
              const senderName = formatContractHrFromName(businessName);
              
              const frontendUrl = import.meta.env.VITE_FRONTEND_URL || window.location.origin;
              const portalLoginLink = `${frontendUrl}/portal/login`;
              
              // Create email with portal credentials
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
                    <h2>Welcome to Your Employee Portal!</h2>
                    <p>Dear ${contractForEmail.employee_first_name || 'Employee'},</p>
                    <p>Your employment contract has been fully signed! Your Employee Portal access has been activated.</p>
                    
                    <div class="credentials-box">
                      <h3 style="margin-top: 0;">Your Login Credentials:</h3>
                      <div class="credential-item">
                        <span class="credential-label">Email:</span>
                        <strong>${contractForEmail.employee_email}</strong>
                      </div>
                      <div class="credential-item">
                        <span class="credential-label">Password:</span>
                        <span class="temp-password">${employeeCreationResult.tempPassword}</span>
                      </div>
                    </div>
                    
                    <div class="warning-box">
                      <strong>⚠️ IMPORTANT:</strong> This is a temporary password. You will be asked to change it when you log in.
                    </div>
                    
                    <p><strong>Click the button below to access your Employee Portal:</strong></p>
                    <a href="${portalLoginLink}" class="portal-button" style="color: white; text-decoration: none;">Go to Employee Portal</a>
                    
                    <p style="margin-top: 15px; font-size: 9px; color: #666;">
                      Or copy and paste this link into your browser:<br>
                      <a href="${portalLoginLink}" style="color: #008080; word-break: break-all;">${portalLoginLink}</a>
                    </p>
                    
                    <p style="margin-top: 30px; font-size: 9px; color: #666;">
                      After logging in, you'll be asked to complete your profile setup, including your personal information, SIN number, and emergency contacts.
                    </p>
                    
                    <p>Best regards,<br>${senderName}</p>
                  </div>
                </body>
                </html>
              `;
              
              const plainTextBody = `Dear ${contractForEmail.employee_first_name || 'Employee'},

Your employment contract has been fully signed! Your Employee Portal access has been activated.

Your Login Credentials:
Email: ${contractForEmail.employee_email}
Temporary Password: ${employeeCreationResult.tempPassword}

⚠️ IMPORTANT: This is a temporary password. You will be asked to change it when you log in.

Access your Employee Portal at:
${portalLoginLink}

After logging in, you'll be asked to complete your profile setup, including your personal information, SIN number, and emergency contacts.

Best regards,
${senderName}`;

              // Send portal credentials email
              try {
                const portalEmailPayload = {
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
                  body: JSON.stringify(portalEmailPayload)
                });

                if (portalEmailResponse.ok) {
                  console.log('[AuthRepSign] ✅ Portal credentials email sent successfully');
                } else {
                  console.warn('[AuthRepSign] Failed to send portal credentials email');
                }
              } catch (portalEmailError) {
                console.error('[AuthRepSign] Error sending portal credentials email:', portalEmailError);
                // Don't fail the signing process if portal email fails
              }
            } else {
              console.log('[AuthRepSign] Portal access already exists or employee already had access');
            }
          } else {
            console.warn('[AuthRepSign] Employee creation/linking returned success:false');
          }
        } catch (employeeError) {
          console.error('[AuthRepSign] Error ensuring employee is linked to business:', employeeError);
          console.error('[AuthRepSign] This may happen if employee already exists - checking for missing links...');
          
          // Fallback: Try to find employee by email and create missing links
          if (contractForEmail.employee_email && contractForEmail.business_id) {
            const { data: employeeUser, error: findError } = await supabase
              .from('users')
              .select('id')
              .eq('email', contractForEmail.employee_email)
              .maybeSingle();
            
            if (employeeUser && !findError) {
              console.log('[AuthRepSign] Found employee by email, checking links...');
              
              // Check and create business_users entry if missing
              const { data: buCheck, error: buCheckError } = await supabase
                .from('business_users')
                .select('id')
                .eq('user_id', employeeUser.id)
                .eq('business_id', contractForEmail.business_id)
                .maybeSingle();
              
              if (!buCheck && !buCheckError) {
                console.log('[AuthRepSign] Missing business_users entry - creating...');
                const { error: buInsertError } = await supabase
                  .from('business_users')
                  .insert({
                    user_id: employeeUser.id,
                    business_id: contractForEmail.business_id,
                    role: 'employee'
                  });
                
                if (buInsertError) {
                  console.error('[AuthRepSign] Failed to create business_users entry:', buInsertError);
                } else {
                  console.log('[AuthRepSign] ✅ Created business_users entry');
                }
              }
              
              // Check and create user_roles entry if missing
              const { data: urCheck, error: urCheckError } = await supabase
                .from('user_roles')
                .select('id')
                .eq('user_id', employeeUser.id)
                .eq('business_id', contractForEmail.business_id)
                .eq('active', true)
                .maybeSingle();
              
              if (!urCheck && !urCheckError) {
                console.log('[AuthRepSign] Missing user_roles entry - creating...');
                const { error: urInsertError } = await supabase
                  .from('user_roles')
                  .insert({
                    user_id: employeeUser.id,
                    business_id: contractForEmail.business_id,
                    role: 'employee',
                    active: true,
                    custom_permissions: {}
                  });
                
                if (urInsertError) {
                  console.error('[AuthRepSign] Failed to create user_roles entry:', urInsertError);
                } else {
                  console.log('[AuthRepSign] ✅ Created user_roles entry');
                }
              }
              
              if ((buCheck || buCheckError) && (urCheck || urCheckError)) {
                console.log('[AuthRepSign] ✅ Employee already has both business_users and user_roles entries');
              }
            }
          }
        }
      }

      console.log('[AuthRepSign] Phase 2: Uploading signed PDF...');
      const { error: pdfUpdateError } = await supabase
        .from('hr_contracts')
        .update({ signed_pdf_data: finalPdfBuffer })
        .eq('id', contract.id);

      if (pdfUpdateError) {
        console.warn('[AuthRepSign] PDF upload failed (emails will still use attachment):', pdfUpdateError.message);
      }

      // Send completed contract to HR email, authorized rep, and employee
      console.log('========== SENDING COMPLETED CONTRACT EMAILS - START ==========');
      console.log('[Email] About to call sendCompletedContract function');
      console.log('[Email] Contract Data Check (using reloaded contract):', {
        id: contractForEmail.id,
        hr_email: contractForEmail.hr_email || 'NOT SET',
        employee_email: contractForEmail.employee_email || 'NOT SET',
        authorized_representative_email: contractForEmail.authorized_representative_email || 'NOT SET',
        business_id: contractForEmail.business_id,
        employee_name: `${contractForEmail.employee_first_name} ${contractForEmail.employee_last_name}`,
        has_pdf_base64: !!finalPdfBase64,
        pdf_base64_length: finalPdfBase64?.length || 0
      });
      
      console.log('[Email] Calling sendCompletedContract NOW...');
      console.log('[Email] Function exists:', typeof sendCompletedContract === 'function');
      console.log('[Email] contractForEmail valid:', !!contractForEmail && !!contractForEmail.id);
      console.log('[Email] finalPdfBase64 valid:', !!finalPdfBase64);
      
      const emailStartTime = Date.now();
      try {
        if (typeof sendCompletedContract !== 'function') {
          throw new Error('sendCompletedContract is not a function!');
        }
        await sendCompletedContract(finalPdfBase64, contractForEmail, signedHTML);
        const emailDuration = Date.now() - emailStartTime;
        console.log('[Email] sendCompletedContract completed in:', emailDuration + 'ms');
        console.log('========== EMAIL SENDING COMPLETE ==========');
      } catch (emailError) {
        console.error('[Email] ========== CRITICAL ERROR IN sendCompletedContract ==========');
        console.error('[Email] Error Type:', emailError?.constructor?.name);
        console.error('[Email] Error Message:', emailError?.message);
        console.error('[Email] Error Stack:', emailError?.stack);
        console.error('[Email] Full Error:', emailError);
        console.error('========== END CRITICAL ERROR ==========');
        // Don't fail the signing process if emails fail
        toast.error('Contract signed successfully, but some emails may not have been sent. Please check email addresses.');
      }

      toast.success('Contract signed successfully! The completed contract has been sent to HR and the employee.');
      
      console.log('[AuthRepSign] Setting up auto-navigation...');
      console.log('[AuthRepSign] Navigate function available:', typeof navigate === 'function');
      console.log('[AuthRepSign] Will navigate in 3 seconds...');
      
      // Auto-navigate like employee signing page
      setTimeout(() => {
        console.log('[AuthRepSign] TIMEOUT FIRED - Navigating now...');
        console.log('[AuthRepSign] Navigate function:', navigate);
        try {
          navigate('/');
          console.log('[AuthRepSign] Navigate called successfully');
        } catch (navError) {
          console.error('[AuthRepSign] Navigation error:', navError);
          // Fallback: try window.location
          console.log('[AuthRepSign] Trying window.location fallback...');
          window.location.href = '/';
        }
      }, 3000);

      console.log('[AuthRepSign] Function complete - setting signing to false');
    } catch (err) {
      console.error('========== AUTHORIZED REP SIGNING - UNHANDLED ERROR ==========');
      console.error('[AuthRepSign] Error Type:', err?.constructor?.name || typeof err);
      console.error('[AuthRepSign] Error Message:', err?.message);
      console.error('[AuthRepSign] Error Stack:', err?.stack);
      console.error('[AuthRepSign] Full Error Object:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
      console.error('[AuthRepSign] Contract State at Error:', {
        id: contract?.id,
        status: contract?.status,
        business_id: contract?.business_id
      });
      console.error('========== END ERROR LOG ==========');
      toast.error('Failed to complete signature. Please try again.');
    } finally {
      console.log('[AuthRepSign] Finally block - setting signing to false');
      setSigning(false);
      console.log('[AuthRepSign] Signing state set to false');
    }
  };

  const sendCompletedContract = async (pdfBase64, contractData, signedHTML = '') => {
    console.log('========== sendCompletedContract FUNCTION CALLED ==========');
    console.log('[Email] Function Entry:', {
      timestamp: new Date().toISOString(),
      has_pdf_base64: !!pdfBase64,
      pdf_base64_length: pdfBase64?.length || 0,
      has_contract_data: !!contractData,
      contract_id: contractData?.id
    });
    
    try {
      console.log('[Email] Starting sendCompletedContract function - INSIDE TRY BLOCK');
      console.log('[Email] Contract Data Check:', {
        id: contractData?.id,
        hr_email: contractData?.hr_email || 'NOT SET',
        employee_email: contractData?.employee_email || 'NOT SET',
        business_id: contractData?.business_id,
        employee_first_name: contractData?.employee_first_name,
        employee_last_name: contractData?.employee_last_name,
        employee_name: `${contractData?.employee_first_name || ''} ${contractData?.employee_last_name || ''}`,
        has_contract_data: !!contractData?.contract_data,
        contract_keys: contractData ? Object.keys(contractData) : 'NO CONTRACT DATA'
      });
      const businessName = await resolveBusinessDisplayName({
        businessId: contractData.business_id,
        contractData: contractData.contract_data,
      });
      console.log('[Email] Final business name for email:', businessName);

      const senderName = formatContractHrFromName(businessName);
      const employeeName = `${contractData.employee_first_name} ${contractData.employee_last_name}`;

      let attachmentBase64 = pdfBase64;
      if ((!attachmentBase64 || attachmentBase64.length < 1000) && signedHTML) {
        try {
          const pdfBlob = await generatePdfBlobFromHtml(
            signedHTML,
            `Signed_Employment_Contract_${employeeName.replace(/\s+/g, '_')}.pdf`
          );
          attachmentBase64 = await blobToBase64(pdfBlob);
        } catch (pdfErr) {
          console.warn('[Email] PDF regeneration for attachment failed:', pdfErr);
        }
      }

      const pdfAttachment = attachmentBase64
        ? [{
            filename: `Signed_Employment_Contract_${employeeName.replace(/\s+/g, '_')}.pdf`,
            content: attachmentBase64,
            contentType: 'application/pdf',
          }]
        : [];

      // Generate viewing link - use signing_token which works for all parties
      const frontendUrl = import.meta.env.VITE_FRONTEND_URL || window.location.origin;
      const contractViewLink = `${frontendUrl}/contract/view/${contractData.signing_token || contractData.authorized_representative_signing_token}`;
      
      console.log('[Email] Contract viewing link:', contractViewLink);
      console.log('[Email] Using token:', contractData.signing_token || contractData.authorized_representative_signing_token);
      
      // Email content for completed contract with viewing link
      const emailHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Contract Fully Signed</title>
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
            .view-button {
              display: inline-block;
              background-color: #008080;
              color: white;
              padding: 15px 30px;
              text-decoration: none;
              border-radius: 5px;
              font-weight: bold;
              margin: 20px 0;
            }
            .view-button:hover {
              background-color: #006666;
            }
          </style>
        </head>
        <body>
          <div class="email-wrapper">
            <h2>Contract Fully Signed</h2>
            <p>The employment contract for <strong>${employeeName}</strong> has been fully signed by both the employee and the authorized representative.</p>
            <p><strong>You can view and download the completed contract by clicking the button below:</strong></p>
            <a href="${contractViewLink}" class="view-button" style="color: white; text-decoration: none;">View & Download Contract</a>
            <p style="margin-top: 15px; font-size: 9px; color: #666;">
              Or copy and paste this link into your browser:<br>
              <a href="${contractViewLink}" style="color: #008080; word-break: break-all;">${contractViewLink}</a>
            </p>
            <p>Best regards,<br>${senderName}</p>
          </div>
        </body>
        </html>
      `;

      const plainTextBody = `The employment contract for ${employeeName} has been fully signed by both the employee and the authorized representative.

You can view and download the completed contract by visiting:
${contractViewLink}

Best regards,
${senderName}`;

      // CRITICAL: Ensure we have email fields - fallback to contract_data if missing
      // This handles cases where emails might be NULL in database columns but stored in contract_data
      let hrEmail = contractData?.hr_email;
      let employeeEmail = contractData?.employee_email;
      let authorizedRepEmail = contractData?.authorized_representative_email;
      
      if (!hrEmail || hrEmail.trim() === '') {
        hrEmail = contractData?.contract_data?.hr_email || 
                 contractData?.contract_data?.keyTerms?.hrEmail ||
                 contractData?.contract_data?.businessData?.hrEmail;
        if (hrEmail) {
          console.log('[Email] Using hr_email from contract_data fallback:', hrEmail);
        }
      }
      
      if (!employeeEmail || employeeEmail.trim() === '') {
        employeeEmail = contractData?.contract_data?.employee_email ||
                       contractData?.contract_data?.keyTerms?.employeeEmail;
        if (employeeEmail) {
          console.log('[Email] Using employee_email from contract_data fallback:', employeeEmail);
        }
      }
      
      if (!authorizedRepEmail || authorizedRepEmail.trim() === '') {
        authorizedRepEmail = contractData?.contract_data?.authorized_representative_email ||
                            contractData?.contract_data?.keyTerms?.authorizedRepresentativeEmail;
        if (authorizedRepEmail) {
          console.log('[Email] Using authorized_representative_email from contract_data fallback:', authorizedRepEmail);
        }
      }
      
      // Send to HR email - EXACT SAME PATTERN AS EMPLOYEE SIGNING
      console.log('========== HR EMAIL - CHECKING ==========');
      console.log('[Email] Checking if HR email should be sent:', {
        has_hr_email: !!hrEmail,
        hr_email: hrEmail || 'MISSING',
        hr_email_type: typeof hrEmail,
        hr_email_length: hrEmail?.length || 0,
        contract_id: contractData?.id,
        contract_data_type: typeof contractData
      });
      console.log('[Email] Final email fields:', {
        hr_email: hrEmail || 'MISSING',
        employee_email: employeeEmail || 'MISSING',
        authorized_representative_email: authorizedRepEmail || 'MISSING'
      });

      if (hrEmail) {
        console.log('[Email] HR Email condition met - Preparing HR email...');
        console.log('[Email] HR Email value:', hrEmail);
        const hrEmailPayload = {
          businessId: contractData.business_id,
          campaignId: `contract-completed-hr-${contractData.id}-${Date.now()}`,
          contactId: `contract-hr-${hrEmail}`,
          emailType: 'transactional',
          to: hrEmail,
          fromEmail: 'noreply@tavarios.ca',
          fromName: senderName,
          subject: `Completed Contract - ${employeeName}`,
          html: emailHTML,
          text: plainTextBody,
          attachments: pdfAttachment,
        };

        console.log('[Email] HR Email Payload Prepared:', {
          to: hrEmailPayload.to,
          fromEmail: hrEmailPayload.fromEmail,
          fromName: hrEmailPayload.fromName,
          subject: hrEmailPayload.subject,
          businessId: hrEmailPayload.businessId,
          campaignId: hrEmailPayload.campaignId,
          contactId: hrEmailPayload.contactId,
          has_html: !!hrEmailPayload.html,
          has_text: !!hrEmailPayload.text,
          viewing_link: contractViewLink
        });

        console.log('[Email] Sending HR email via Edge Function...');
        console.log('[Email] Edge Function URL:', `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`);
        
        try {
          const hrEmailStartTime = Date.now();
          const hrResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify(hrEmailPayload)
          });

          const hrEmailDuration = Date.now() - hrEmailStartTime;
          console.log('[Email] HR Email Request Duration:', hrEmailDuration + 'ms');
          console.log('[Email] HR Email Response Status:', hrResponse.status, hrResponse.statusText);
          console.log('[Email] HR Email Response OK:', hrResponse.ok);

          if (!hrResponse.ok) {
            const errorText = await hrResponse.text();
            console.error('========== HR EMAIL SEND FAILED ==========');
            console.error('[Email] Response Status:', hrResponse.status);
            console.error('[Email] Response Status Text:', hrResponse.statusText);
            console.error('[Email] Error Response:', errorText);
            console.error('[Email] Email Payload:', JSON.stringify(hrEmailPayload, null, 2));
            console.error('========== END HR EMAIL ERROR ==========');
            // Don't throw - continue with other emails
          } else {
            const responseData = await hrResponse.json().catch(() => ({ message: 'No JSON response' }));
            console.log('========== HR EMAIL SENT SUCCESSFULLY ==========');
            console.log('[Email] Response Data:', responseData);
            console.log('[Email] Email sent to HR:', hrEmail);
            console.log('[Email] Message ID:', responseData.messageId || responseData.message_id || 'N/A');
            console.log('[Email] Success:', responseData.ok !== false);
            console.log('========== END HR EMAIL SUCCESS ==========');
          }
        } catch (hrEmailError) {
          console.error('========== HR EMAIL SEND EXCEPTION ==========');
          console.error('[Email] Error Type:', hrEmailError?.constructor?.name || typeof hrEmailError);
          console.error('[Email] Error Message:', hrEmailError?.message);
          console.error('[Email] Error Stack:', hrEmailError?.stack);
          console.error('[Email] Full Error:', JSON.stringify(hrEmailError, Object.getOwnPropertyNames(hrEmailError), 2));
          console.error('[Email] Email Payload That Failed:', hrEmailPayload);
          console.error('========== END HR EMAIL EXCEPTION ==========');
          // Don't throw - continue with other emails
        }
      } else {
        console.warn('========== HR EMAIL NOT SENT - CONDITIONS NOT MET ==========');
        console.warn('[Email] Reason: Missing hr_email');
        console.warn('[Email] Contract Data:', {
          hr_email: hrEmail || 'MISSING',
          contract_id: contractData.id
        });
        console.warn('========== END HR EMAIL SKIP LOG ==========');
      }

      // Send to employee
      console.log('[Email] Checking employee email condition...');
      console.log('[Email] Employee Email Present:', !!employeeEmail);
      
      if (employeeEmail) {
        console.log('[Email] Employee Email condition met - Preparing employee email...');
        const employeeEmailPayload = {
          businessId: contractData.business_id,
          campaignId: `contract-completed-employee-${contractData.id}-${Date.now()}`,
          contactId: `contract-employee-${employeeEmail}`,
          emailType: 'transactional',
          to: employeeEmail,
          fromEmail: 'noreply@tavarios.ca',
          fromName: senderName,
          subject: `Your Completed Employment Contract`,
          html: emailHTML.replace('The employment contract for', 'Your employment contract has'),
          text: plainTextBody.replace('The employment contract for', 'Your employment contract has'),
          attachments: pdfAttachment,
        };

        console.log('[Email] Employee Email Payload:', {
          to: employeeEmailPayload.to,
          fromName: employeeEmailPayload.fromName,
          subject: employeeEmailPayload.subject,
          viewing_link: contractViewLink
        });

        console.log('[Email] Sending employee email via Edge Function...');
        const employeeEmailStartTime = Date.now();
        const employeeResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify(employeeEmailPayload)
        });

        const employeeEmailDuration = Date.now() - employeeEmailStartTime;
        console.log('[Email] Employee Email Request Duration:', employeeEmailDuration + 'ms');
        console.log('[Email] Employee Email Response Status:', employeeResponse.status, employeeResponse.statusText);

        if (!employeeResponse.ok) {
          const errorText = await employeeResponse.text();
          console.error('========== EMPLOYEE EMAIL SEND FAILED ==========');
          console.error('[Email] Response Status:', employeeResponse.status);
          console.error('[Email] Error Response:', errorText);
          console.error('[Email] Email Payload:', JSON.stringify(employeeEmailPayload, null, 2));
          console.error('========== END EMPLOYEE EMAIL ERROR ==========');
          // Don't throw - continue with other emails
        } else {
          const responseData = await employeeResponse.json().catch(() => ({ message: 'No JSON response' }));
          console.log('========== EMPLOYEE EMAIL SENT SUCCESSFULLY ==========');
          console.log('[Email] Response Data:', responseData);
          console.log('[Email] Email sent to employee:', employeeEmail);
          console.log('[Email] Message ID:', responseData.messageId || responseData.message_id || 'N/A');
          console.log('[Email] Success:', responseData.ok !== false);
          console.log('========== END EMPLOYEE EMAIL SUCCESS ==========');
        }
      } else {
        console.warn('[Email] Employee email not sent - employee_email is missing');
      }

      // Send to authorized representative
      console.log('[Email] Checking authorized rep email condition...');
      console.log('[Email] Authorized Rep Email Present:', !!authorizedRepEmail);
      
      if (authorizedRepEmail) {
        console.log('[Email] Authorized Rep Email condition met - Preparing authorized rep email...');
        const authRepEmailPayload = {
          businessId: contractData.business_id,
          campaignId: `contract-completed-authrep-${contractData.id}-${Date.now()}`,
          contactId: `contract-authrep-${authorizedRepEmail}`,
          emailType: 'transactional',
          to: authorizedRepEmail,
          fromEmail: 'noreply@tavarios.ca',
          fromName: senderName,
          subject: `Completed Contract - ${employeeName}`,
          html: emailHTML,
          text: plainTextBody,
          attachments: pdfAttachment,
        };

        console.log('[Email] Authorized Rep Email Payload:', {
          to: authRepEmailPayload.to,
          fromName: authRepEmailPayload.fromName,
          subject: authRepEmailPayload.subject,
          has_viewing_link: !!contractViewLink
        });

        console.log('[Email] Sending authorized rep email via Edge Function...');
        const authRepEmailStartTime = Date.now();
        const authRepResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify(authRepEmailPayload)
        });

        const authRepEmailDuration = Date.now() - authRepEmailStartTime;
        console.log('[Email] Authorized Rep Email Request Duration:', authRepEmailDuration + 'ms');
        console.log('[Email] Authorized Rep Email Response Status:', authRepResponse.status, authRepResponse.statusText);

        if (!authRepResponse.ok) {
          const errorText = await authRepResponse.text();
          console.error('========== AUTHORIZED REP EMAIL SEND FAILED ==========');
          console.error('[Email] Response Status:', authRepResponse.status);
          console.error('[Email] Error Response:', errorText);
          console.error('[Email] Email Payload:', JSON.stringify(authRepEmailPayload, null, 2));
          console.error('========== END AUTHORIZED REP EMAIL ERROR ==========');
          // Don't throw - continue with other emails
        } else {
          const responseData = await authRepResponse.json().catch(() => ({ message: 'No JSON response' }));
          console.log('========== AUTHORIZED REP EMAIL SENT SUCCESSFULLY ==========');
          console.log('[Email] Response Data:', responseData);
          console.log('[Email] Email sent to authorized rep:', authorizedRepEmail);
          console.log('[Email] Message ID:', responseData.messageId || responseData.message_id || 'N/A');
          console.log('[Email] Success:', responseData.ok !== false);
          console.log('========== END AUTHORIZED REP EMAIL SUCCESS ==========');
        }
      } else {
        console.warn('[Email] Authorized rep email not sent - authorized_representative_email is missing');
      }

      console.log('========== END EMAIL SENDING PROCESS ==========');
      console.log('[Email] sendCompletedContract function completed successfully');
    } catch (emailError) {
      console.error('========== EMAIL SENDING EXCEPTION ==========');
      console.error('[Email] Exception caught in sendCompletedContract');
      console.error('[Email] Error Type:', emailError?.constructor?.name || typeof emailError);
      console.error('[Email] Error Message:', emailError?.message);
      console.error('[Email] Error Stack:', emailError?.stack);
      console.error('[Email] Full Error:', JSON.stringify(emailError, Object.getOwnPropertyNames(emailError), 2));
      console.error('[Email] Contract Data at Error:', contractData);
      console.error('[Email] PDF Base64 at Error:', {
        has_pdf: !!pdfBase64,
        pdf_length: pdfBase64?.length || 0
      });
      console.error('========== END EMAIL EXCEPTION ==========');
      // Don't fail the whole process if email fails
      throw emailError; // Re-throw so we can see it in the outer catch
    }
    console.log('[Email] sendCompletedContract function exiting');
  };

  // Remove the signed state and success screen - use auto-navigate instead

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
      console.error('[AuthorizedRepSignScreen] Error generating PDF:', error);
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
      console.error('[AuthorizedRepSignScreen] Error printing:', error);
      toast.error('Failed to open print dialog. Please try again.');
    }
  };

  // Styles using TavariStyles
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
      marginBottom: TavariStyles.spacing['3xl'],
      borderBottom: `2px solid ${TavariStyles.colors.primary}`,
      paddingBottom: TavariStyles.spacing.lg
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      fontFamily: TavariStyles.typography.fontFamily,
      color: TavariStyles.colors.primary,
      marginBottom: TavariStyles.spacing.sm
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.normal,
      fontFamily: TavariStyles.typography.fontFamily,
      color: TavariStyles.colors.gray600
    },
    errorMessage: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      marginBottom: TavariStyles.spacing.lg
    },
    formGroup: {
      marginBottom: TavariStyles.spacing.lg
    },
    label: {
      ...TavariStyles.components.form.label,
      marginBottom: TavariStyles.spacing.xs
    },
    input: {
      ...TavariStyles.components.form.input,
      width: '100%'
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

  if (error || expired) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.header}>
            <h1 style={styles.title}>Contract Signing</h1>
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
          <h1 style={styles.title}>Authorized Representative Signature</h1>
          <p style={styles.subtitle}>
            Please review and sign the contract for {contract.employee_first_name} {contract.employee_last_name}
          </p>
        </div>

        {/* PDF Download and Print Buttons */}
        {contract.contract_html && (
          <div style={{
            display: 'flex',
            gap: TavariStyles.spacing.md,
            marginBottom: TavariStyles.spacing.lg,
            flexWrap: 'wrap'
          }}>
            <button
              onClick={handleDownloadPDF}
              style={{
                ...TavariStyles.components.button?.base,
                ...TavariStyles.components.button?.variants?.secondary,
                display: 'flex',
                alignItems: 'center',
                gap: TavariStyles.spacing.sm,
                padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`
              }}
            >
              <Download size={18} />
              Download PDF
            </button>
            <button
              onClick={handlePrint}
              style={{
                ...TavariStyles.components.button?.base,
                ...TavariStyles.components.button?.variants?.secondary,
                display: 'flex',
                alignItems: 'center',
                gap: TavariStyles.spacing.sm,
                padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`
              }}
            >
              <Printer size={18} />
              Print
            </button>
          </div>
        )}

        {contract.contract_html && (
          <div 
            style={{
              marginBottom: TavariStyles.spacing.xl,
              border: `1px solid ${TavariStyles.colors.gray200}`,
              borderRadius: TavariStyles.borderRadius.md,
              padding: TavariStyles.spacing.lg,
              maxHeight: '600px',
              overflowY: 'auto',
              backgroundColor: TavariStyles.colors.gray50
            }}
            dangerouslySetInnerHTML={{ __html: extractBodyHtml(contract.contract_html) }}
          />
        )}

        <div style={{ marginBottom: TavariStyles.spacing.xl }}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Your Name (Authorized Representative) *</label>
            <input
              type="text"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              style={styles.input}
              placeholder="Enter your full name"
              required
            />
          </div>

          <TavariCheckbox
            checked={digitalSignatureConsent}
            onChange={setDigitalSignatureConsent}
            label="I consent to the use of my digital signature on this contract"
            size="md"
            id="digitalSignatureConsent"
          />

          <DigitalSignature
            onSignatureComplete={handleSignatureComplete}
            signerName={signerName}
            documentType="contract"
            isReadOnly={signing}
            requireConsent={true}
            consentChecked={digitalSignatureConsent}
            onCancel={() => {
              console.log('[AuthRepSign] Cancel button clicked');
              navigate('/');
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default AuthorizedRepSignScreen;

