// Authorized Representative Signing Screen - Public route for authorized representatives to sign contracts
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { CheckCircle, AlertCircle, X, FileText, Download, Printer } from 'lucide-react';
import DigitalSignature from '../../components/HR/DigitalSignature';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import toast from 'react-hot-toast';
import html2pdf from 'html2pdf.js';
import { TavariStyles } from '../../utils/TavariStyles';
import { createEmployeeFromContract } from '../../utils/contractEmployeeCreation';

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
        .select('id, business_id, employee_email, employee_first_name, employee_last_name, contract_data, contract_html, authorized_representative_signing_token, status, expires_at, signed_at, authorized_representative_name, authorized_representative_email, authorized_representative_signed_at, hr_email, digital_signature_data, signed_pdf_data')
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

      setContract(data);
      
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
      // Get the signed PDF that already has employee signature
      let contractHTML = contract.contract_html || '';
      
      // Add authorized representative signature to the contract
      const signatureDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      
      // Find the authorized representative signature section and replace signature lines with actual signature
      // Pattern captures: before label, label, content before signature line, signature line (REMOVE), date label, date line (REMOVE), after
      // Updated to match font-size: 9px (increased from 6px)
      const authRepSignatureSection = /(<p style="margin-bottom: 20px;">By its authorized representative:<\/p>[\s\S]*?<div style="margin-bottom: 25px;">[\s\S]*?<p style="margin-bottom: 4px; font-size: [0-9]+px;">Authorized Representative<\/p>)([\s\S]*?)(<div style="border-bottom: 1px solid #000; height: 40px; margin-bottom: 15px;"><\/div>)([\s\S]*?<p style="margin-bottom: 4px; font-size: [0-9]+px;">Date:<\/p>)([\s\S]*?<div style="border-bottom: 1px solid #000; height: 40px;"><\/div>)/;
      
      // Replace signature line and date line with actual signature image, name, and date (REMOVE $3 and $5 which are the border-bottom divs)
      const signatureReplacement = `$1$2<img src="${signatureRecord.signatureData}" alt="Signature" style="max-width: 300px; height: auto; border: 1px solid #ccc; padding: 10px; background: white; margin-bottom: 10px; display: block;" /><p style="margin-bottom: 4px; font-size: 9px;"><strong>${signerName}</strong></p>$4<p style="margin-top: 8px; font-size: 9px;">${signatureDate}</p>`;
      
      // Try to replace the existing signature section
      if (authRepSignatureSection.test(contractHTML)) {
        contractHTML = contractHTML.replace(authRepSignatureSection, signatureReplacement);
      } else {
        // Fallback: simpler replacement - also remove date line
        const simplePattern = /(<p style="margin-bottom: 4px; font-size: [0-9]+px;">Authorized Representative<\/p>)([\s\S]*?)(<div style="border-bottom: 1px solid #000; height: 40px; margin-bottom: 15px;"><\/div>)([\s\S]*?<p style="margin-bottom: 4px; font-size: [0-9]+px;">Date:<\/p>)([\s\S]*?<div style="border-bottom: 1px solid #000; height: 40px;"><\/div>)/;
        if (simplePattern.test(contractHTML)) {
          // Remove $3 (signature line) and $5 (date line)
          contractHTML = contractHTML.replace(simplePattern, `$1<img src="${signatureRecord.signatureData}" alt="Signature" style="max-width: 300px; height: auto; border: 1px solid #ccc; padding: 10px; background: white; margin-bottom: 10px; display: block;" /><p style="margin-bottom: 4px; font-size: 9px;"><strong>${signerName}</strong></p>$4<p style="margin-top: 8px; font-size: 9px;">${signatureDate}</p>`);
        } else {
          // Last resort: append before </body>
          contractHTML = contractHTML.replace('</body>', `<div style="margin-top: 20px;"><p><strong>Authorized Representative Signature:</strong></p><img src="${signatureRecord.signatureData}" alt="Signature" style="max-width: 300px; height: auto; border: 1px solid #ccc; padding: 10px; background: white;" /><p><strong>${signerName}</strong></p><p>Signed: ${signatureDate}</p></div></body>`);
        }
      }
      
      // Additional cleanup: Remove ALL remaining signature lines and empty divs with large heights
      // Remove any border-bottom divs (signature lines) that might still be there
      contractHTML = contractHTML.replace(
        /<div style="border-bottom: 1px solid #000; height: 40px[^"]*"><\/div>/g,
        ''
      );
      // Remove any empty divs with height: 40px that might be creating gaps
      contractHTML = contractHTML.replace(
        /<div[^>]*height:\s*40px[^>]*><\/div>/g,
        ''
      );
      
      const signedHTML = contractHTML;

      // Generate final signed PDF with both signatures
      const tempDiv = document.createElement('div');
      tempDiv.style.position = 'absolute';
      tempDiv.style.left = '-9999px';
      tempDiv.style.top = '-9999px';
      tempDiv.style.width = '8.5in';
      tempDiv.style.backgroundColor = 'white';
      tempDiv.innerHTML = signedHTML;
      document.body.appendChild(tempDiv);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const finalPdfBlob = await html2pdf().set({
        margin: [0.5, 0.5, 0.5, 0.5],
        filename: `Fully_Signed_Employment_Contract_${contract.employee_first_name}_${contract.employee_last_name}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { 
          scale: 2, 
          useCORS: true,
          logging: false,
          letterRendering: true,
          allowTaint: true,
          height: tempDiv.scrollHeight,
          width: tempDiv.scrollWidth,
          windowWidth: tempDiv.scrollWidth,
          windowHeight: tempDiv.scrollHeight
        },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
        pagebreak: { mode: ['css'], avoid: ['.contract-section'] }
      }).from(tempDiv).outputPdf('blob');
      
      document.body.removeChild(tempDiv);

      // Convert to base64 for storage
      const finalPdfBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64String = reader.result.split(',')[1];
          resolve(base64String);
        };
        reader.onerror = reject;
        reader.readAsDataURL(finalPdfBlob);
      });

      const finalPdfBuffer = Uint8Array.from(atob(finalPdfBase64), c => c.charCodeAt(0));

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
        .select('id, business_id, employee_email, employee_first_name, employee_last_name, hr_email, authorized_representative_email, authorized_representative_name, contract_data, signing_token, authorized_representative_signing_token')
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
      if (!contractForEmail.hr_email && contractForEmail.contract_data?.hr_email) {
        contractForEmail.hr_email = contractForEmail.contract_data.hr_email;
        console.log('[AuthRepSign] Using hr_email from contract_data:', contractForEmail.hr_email);
      }
      if (!contractForEmail.authorized_representative_email && contractForEmail.contract_data?.authorized_representative_email) {
        contractForEmail.authorized_representative_email = contractForEmail.contract_data.authorized_representative_email;
        console.log('[AuthRepSign] Using authorized_representative_email from contract_data:', contractForEmail.authorized_representative_email);
      }
      if (!contractForEmail.employee_email && contractForEmail.contract_data?.employee_email) {
        contractForEmail.employee_email = contractForEmail.contract_data.employee_email;
        console.log('[AuthRepSign] Using employee_email from contract_data:', contractForEmail.employee_email);
      }

      // Note: Employee should already be created when contract was first created
      // Just verify employee exists and is linked to business
      if (updateData?.[0]?.status === 'signed' && contract.employee_id) {
        console.log('[AuthRepSign] Contract fully signed - verifying employee exists:', contract.employee_id);
        
        // Verify employee is linked to business
        const { data: roleCheck, error: roleError } = await supabase
          .from('user_roles')
          .select('id')
          .eq('user_id', contract.employee_id)
          .eq('business_id', contract.business_id)
          .maybeSingle();
        
        if (!roleCheck && !roleError) {
          // Employee exists but not linked - create link
          console.log('[AuthRepSign] Employee not linked to business - creating link...');
          const { error: linkError } = await supabase
            .from('user_roles')
            .insert({
              user_id: contract.employee_id,
              business_id: contract.business_id,
              role: 'employee',
              active: true
            });
          
          if (linkError) {
            console.error('[AuthRepSign] Error linking employee to business:', linkError);
            toast.error('Contract signed, but employee may not appear in profiles. Please verify employee link.');
          } else {
            console.log('[AuthRepSign] Employee linked to business successfully');
          }
        } else if (roleCheck) {
          console.log('[AuthRepSign] Employee already linked to business');
        }
      } else if (updateData?.[0]?.status === 'signed' && !contract.employee_id) {
        // Contract signed but no employee_id - this shouldn't happen if employee was created when contract was created
        console.warn('[AuthRepSign] Contract signed but no employee_id found. Employee may not have been created when contract was created.');
        toast.error('Contract signed, but employee profile may be missing. Please check employee profiles.');
      }

      // Phase 2: Upload PDF separately (non-blocking)
      console.log('[AuthRepSign] Phase 2: Uploading PDF data separately (non-blocking)...');
      (async () => {
        try {
          const pdfUpdateStartTime = Date.now();
          const { error: pdfUpdateError } = await supabase
            .from('hr_contracts')
            .update({ signed_pdf_data: finalPdfBuffer })
            .eq('id', contract.id);
          
          const pdfUpdateDuration = Date.now() - pdfUpdateStartTime;
          
          if (pdfUpdateError) {
            console.warn('[AuthRepSign] PDF upload failed (non-critical):', {
              error: pdfUpdateError.message,
              code: pdfUpdateError.code,
              duration: pdfUpdateDuration + 'ms'
            });
          } else {
            console.log('[AuthRepSign] PDF uploaded successfully:', {
              duration: pdfUpdateDuration + 'ms',
              size: finalPdfBuffer.length + ' bytes'
            });
          }
        } catch (pdfError) {
          console.warn('[AuthRepSign] PDF upload exception (non-critical):', pdfError.message);
        }
      })();

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
        await sendCompletedContract(finalPdfBase64, contractForEmail);
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

  const sendCompletedContract = async (pdfBase64, contractData) => {
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
      // Get business name for sender - check contract_data first, then database
      let businessName = 'The Company';
      
      // First, try to get from contract_data (already loaded)
      if (contractData.contract_data?.businessData?.name) {
        businessName = contractData.contract_data.businessData.name;
        console.log('[Email] Using business name from contract_data:', businessName);
      } else if (contractData.contract_data?.businessData?.business_name) {
        businessName = contractData.contract_data.businessData.business_name;
        console.log('[Email] Using business_name from contract_data:', businessName);
      } else if (contractData.business_id) {
        // Fallback: query database
        console.log('[Email] Business name not in contract_data, querying database...');
        try {
          const { data: bizData, error: bizError } = await supabase
            .from('businesses')
            .select('business_name, name')
            .eq('id', contractData.business_id)
            .maybeSingle();
          
          if (bizError) {
            console.warn('[Email] Error querying business:', bizError.message);
          } else if (bizData) {
            businessName = bizData.business_name || bizData.name || businessName;
            console.log('[Email] Using business name from database:', businessName);
          } else {
            console.warn('[Email] Business not found in database, using default');
          }
        } catch (err) {
          console.warn('[Email] Exception querying business:', err.message);
        }
      }
      
      console.log('[Email] Final business name for email:', businessName);

      const senderName = `${businessName} - HR`;
      const employeeName = `${contractData.employee_first_name} ${contractData.employee_last_name}`;
      
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
            <p style="margin-top: 15px; font-size: 12px; color: #666;">
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

      // Send to HR email - EXACT SAME PATTERN AS EMPLOYEE SIGNING
      console.log('========== HR EMAIL - CHECKING ==========');
      console.log('[Email] Checking if HR email should be sent:', {
        has_hr_email: !!contractData?.hr_email,
        hr_email: contractData?.hr_email || 'MISSING',
        hr_email_type: typeof contractData?.hr_email,
        hr_email_length: contractData?.hr_email?.length || 0,
        contract_id: contractData?.id,
        contract_data_type: typeof contractData
      });
      console.log('[Email] Full contractData object:', JSON.stringify(contractData, null, 2));

      if (contractData?.hr_email) {
        console.log('[Email] HR Email condition met - Preparing HR email...');
        console.log('[Email] HR Email value:', contractData.hr_email);
        const hrEmailPayload = {
          businessId: contractData.business_id,
          campaignId: `contract-completed-hr-${contractData.id}-${Date.now()}`,
          contactId: `contract-hr-${contractData.hr_email}`,
          to: contractData.hr_email,
          fromEmail: 'noreply@tavarios.ca',
          fromName: senderName,
          subject: `Completed Contract - ${employeeName}`,
          html: emailHTML,
          text: plainTextBody
          // No attachments - using viewing link instead
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
            console.log('[Email] Email sent to HR:', contractData.hr_email);
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
          hr_email: contractData.hr_email || 'MISSING',
          contract_id: contractData.id
        });
        console.warn('========== END HR EMAIL SKIP LOG ==========');
      }

      // Send to employee
      console.log('[Email] Checking employee email condition...');
      console.log('[Email] Employee Email Present:', !!contractData.employee_email);
      
      if (contractData.employee_email) {
        console.log('[Email] Employee Email condition met - Preparing employee email...');
        const employeeEmailPayload = {
          businessId: contractData.business_id,
          campaignId: `contract-completed-employee-${contractData.id}-${Date.now()}`,
          contactId: `contract-employee-${contractData.employee_email}`,
          to: contractData.employee_email,
          fromEmail: 'noreply@tavarios.ca',
          fromName: senderName,
          subject: `Your Completed Employment Contract`,
          html: emailHTML.replace('The employment contract for', 'Your employment contract has'),
          text: plainTextBody.replace('The employment contract for', 'Your employment contract has')
          // No attachments - using viewing link instead
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
          console.log('[Email] Email sent to employee:', contractData.employee_email);
          console.log('[Email] Message ID:', responseData.messageId || responseData.message_id || 'N/A');
          console.log('[Email] Success:', responseData.ok !== false);
          console.log('========== END EMPLOYEE EMAIL SUCCESS ==========');
        }
      } else {
        console.warn('[Email] Employee email not sent - employee_email is missing');
      }

      // Send to authorized representative
      console.log('[Email] Checking authorized rep email condition...');
      console.log('[Email] Authorized Rep Email Present:', !!contractData.authorized_representative_email);
      
      if (contractData.authorized_representative_email) {
        console.log('[Email] Authorized Rep Email condition met - Preparing authorized rep email...');
        const authRepEmailPayload = {
          businessId: contractData.business_id,
          campaignId: `contract-completed-authrep-${contractData.id}-${Date.now()}`,
          contactId: `contract-authrep-${contractData.authorized_representative_email}`,
          to: contractData.authorized_representative_email,
          fromEmail: 'noreply@tavarios.ca',
          fromName: senderName,
          subject: `Completed Contract - ${employeeName}`,
          html: emailHTML,
          text: plainTextBody
          // No attachments - using viewing link instead
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
          console.log('[Email] Email sent to authorized rep:', contractData.authorized_representative_email);
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
      
      // Create a temporary container for PDF generation
      const element = document.createElement('div');
      element.innerHTML = contract.contract_html;
      
      // Configure PDF options
      const opt = {
        margin: [0.5, 0.5, 0.5, 0.5],
        filename: `Employment_Contract_${contract.employee_first_name}_${contract.employee_last_name}_${new Date().toISOString().split('T')[0]}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { 
          scale: 2,
          useCORS: true,
          logging: false
        },
        jsPDF: { 
          unit: 'in', 
          format: 'letter', 
          orientation: 'portrait' 
        }
      };

      // Generate and download PDF
      await html2pdf().set(opt).from(element).save();
      
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
            dangerouslySetInnerHTML={{ __html: contract.contract_html }}
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

