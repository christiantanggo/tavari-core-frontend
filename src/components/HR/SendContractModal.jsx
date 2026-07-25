import React, { useState, useEffect } from 'react';
import { X, Send, Mail } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';
import html2pdf from 'html2pdf.js';
import {
  formatContractHrFromName,
  mergeContractDataForSave,
  parseContractWageAmount,
  pickBusinessDisplayName,
  resolveContractEmployeeId,
  resolveExistingContractId,
  saveContractSections,
} from '../../utils/contractPersistence';

const getContractEndDate = (keyTerms) =>
  keyTerms?.contractEndDate || keyTerms?.endDate || null;

const SendContractModal = ({ isOpen, onClose, contractData, businessData, onSendComplete }) => {
  const [sending, setSending] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [toEmail, setToEmail] = useState('');
  const [ccEmail, setCcEmail] = useState('');
  const [acceptByDate, setAcceptByDate] = useState('');
  const [mailSettings, setMailSettings] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [authorizedRepName, setAuthorizedRepName] = useState('');
  const [authorizedRepEmail, setAuthorizedRepEmail] = useState('');
  const [hrEmail, setHrEmail] = useState('');

  // Get current user
  useEffect(() => {
    const getCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setAuthUser(user);
    };
    if (isOpen) {
      getCurrentUser();
    }
  }, [isOpen]);

  // Load mail settings when modal opens
  useEffect(() => {
    if (isOpen && businessData?.id) {
      const loadMailSettings = async () => {
        try {
          const { data, error } = await supabase
            .from('mail_settings')
            .select('from_email, from_name, reply_to')
            .eq('business_id', businessData.id)
            .maybeSingle();
          
          if (error) {
            console.error('Error loading mail settings:', error);
            // Don't set mailSettings if there's an error - will use fallback
          } else if (data) {
            setMailSettings(data);
            console.log('Mail settings loaded:', data);
          } else {
            console.log('No mail settings found for business:', businessData.id);
            setMailSettings(null);
          }
        } catch (err) {
          console.error('Error fetching mail settings:', err);
          setMailSettings(null);
        }
      };
      
      loadMailSettings();
    } else {
      setMailSettings(null);
    }
  }, [isOpen, businessData?.id]);

  // Initialize email content when modal opens
  React.useEffect(() => {
    if (isOpen && contractData?.keyTerms) {
      const { firstName, lastName } = contractData.keyTerms;
      setEmailSubject(`Employment Contract - ${firstName || ''} ${lastName || ''}`.trim());
      
      // Set default email addresses (editable)
      setToEmail(contractData.keyTerms.employeeEmail || '');
      setCcEmail(contractData.keyTerms.employerContactEmail || businessData?.business_email || 'hr@tanggo.ca');
      
      // Initialize HR email and authorized rep email from contract_data or business settings
      // This ensures they're pre-filled if the contract was previously saved
      const defaultHrEmail = contractData.contract_data?.hr_email || 
                             contractData.keyTerms?.hrEmail || 
                             businessData?.business_email || 
                             'hr@tanggo.ca';
      setHrEmail(defaultHrEmail);
      
      const defaultAuthRepEmail = contractData.contract_data?.authorized_representative_email ||
                                  contractData.keyTerms?.authorizedRepresentativeEmail || 
                                  '';
      setAuthorizedRepEmail(defaultAuthRepEmail);
      
      const defaultAuthRepName = contractData.contract_data?.authorized_representative_name ||
                                 contractData.keyTerms?.authorizedRepresentativeName || 
                                 '';
      setAuthorizedRepName(defaultAuthRepName);
      
      // Set default accept by date to 48 hours from now
      const defaultAcceptBy = new Date();
      defaultAcceptBy.setHours(defaultAcceptBy.getHours() + 48);
      // Format as YYYY-MM-DD in local timezone to avoid timezone shifts
      const year = defaultAcceptBy.getFullYear();
      const month = String(defaultAcceptBy.getMonth() + 1).padStart(2, '0');
      const day = String(defaultAcceptBy.getDate()).padStart(2, '0');
      setAcceptByDate(`${year}-${month}-${day}`);
      
      // Update email body to include accept by date (use local date, not UTC)
      const acceptByDateStr = defaultAcceptBy.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        timeZone: 'America/Toronto' // Use business timezone
      });
      
      setEmailBody(`Dear ${firstName || 'Employee'},

Please find attached your employment contract for review.

This contract offer will expire on ${acceptByDateStr} at 11:59pm. Please review the contract and let us know if you have any questions or concerns.

Best regards`);
    }
  }, [isOpen, contractData, businessData]);

  const handleSend = async () => {
    // Prevent duplicate sends
    if (sending) {
      console.warn('[SendContractModal] Already sending, ignoring duplicate request');
      return;
    }

    if (!toEmail || !toEmail.trim()) {
      toast.error('Employee email (To) is required');
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(toEmail.trim())) {
      toast.error('Please enter a valid employee email address');
      return;
    }

    // Validate CC emails (support multiple emails separated by commas)
    if (ccEmail && ccEmail.trim()) {
      const ccEmails = ccEmail.split(',').map(email => email.trim()).filter(email => email.length > 0);
      const invalidEmails = ccEmails.filter(email => !emailRegex.test(email));
      if (invalidEmails.length > 0) {
        toast.error(`Please enter valid CC email addresses. Invalid: ${invalidEmails.join(', ')}`);
        return;
      }
    }

    if (!acceptByDate) {
      toast.error('Please select an "Accept by" date');
      return;
    }

    // Validate accept by date is in the future
    const acceptBy = new Date(acceptByDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (acceptBy < today) {
      toast.error('Accept by date must be in the future');
      return;
    }

    // Validate authorized representative fields
    if (!authorizedRepName || !authorizedRepName.trim()) {
      toast.error('Authorized Representative name is required');
      return;
    }

    if (!authorizedRepEmail || !authorizedRepEmail.trim()) {
      toast.error('Authorized Representative email is required');
      return;
    }

    if (!emailRegex.test(authorizedRepEmail.trim())) {
      toast.error('Please enter a valid Authorized Representative email address');
      return;
    }

    if (!hrEmail || !hrEmail.trim()) {
      toast.error('HR Email is required');
      return;
    }

    if (!emailRegex.test(hrEmail.trim())) {
      toast.error('Please enter a valid HR email address');
      return;
    }

    setSending(true);
    try {
      // FORCE use verified email - contracts ALWAYS use noreply@tavarios.ca (same as receipts)
      // Do NOT use business email or mail settings - only use the verified email
      const senderEmail = 'noreply@tavarios.ca';

      // Generate contract HTML using the function from contractData
      const generatePDF = contractData.generateContractPDF || (() => {
        // Fallback - basic HTML
        return `<!DOCTYPE html><html><head><title>Contract</title></head><body><h1>Employment Contract</h1><p>Employee: ${contractData.keyTerms?.firstName || ''} ${contractData.keyTerms?.lastName || ''}</p></body></html>`;
      });
      
      const contractHTML = generatePDF();

      // Generate PDF from HTML using html2pdf.js
      // Create a temporary DOM element to ensure full HTML rendering
      toast.loading('Generating PDF...', { id: 'pdf-generation' });
      
      // Create a temporary container element for PDF generation
      // html2pdf works better with DOM elements than HTML strings
      const tempDiv = document.createElement('div');
      tempDiv.style.position = 'absolute';
      tempDiv.style.left = '-9999px';
      tempDiv.style.top = '-9999px';
      tempDiv.style.width = '8.5in';
      tempDiv.style.backgroundColor = 'white';
      tempDiv.innerHTML = contractHTML;
      document.body.appendChild(tempDiv);
      
      // Wait a bit for DOM to be ready and images/styles to load
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Declare pdfBase64 outside try block so it's accessible later
      let pdfBase64;
      
      try {
        const pdfBlob = await html2pdf().set({
          margin: [0.5, 0.5, 0.5, 0.5],
          filename: `Employment_Contract_${contractData.keyTerms?.firstName || ''}_${contractData.keyTerms?.lastName || ''}.pdf`,
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
          pagebreak: { mode: ['avoid-all', 'css', 'legacy'], before: '.contract-section', after: '.contract-section', avoid: ['h1', 'h2', 'h3'] }
        }).from(tempDiv).outputPdf('blob');
        
        // Clean up temporary element
        document.body.removeChild(tempDiv);
        
        // Convert PDF blob to base64 for storage
        pdfBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64String = reader.result.split(',')[1]; // Remove data:application/pdf;base64, prefix
            resolve(base64String);
          };
          reader.onerror = reject;
          reader.readAsDataURL(pdfBlob);
        });
      } catch (pdfError) {
        // Clean up temporary element if it still exists
        if (document.body.contains(tempDiv)) {
          document.body.removeChild(tempDiv);
        }
        console.error('Error generating PDF:', pdfError);
        toast.error('Failed to generate PDF. Please try again.', { id: 'pdf-generation' });
        throw pdfError;
      }

      // Generate signing token for employee
      const signingToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      // Generate signing token for authorized representative (will be used after employee signs)
      const authorizedRepSigningToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      // Calculate expires_at (accept by date at 11:59pm)
      const expiresAt = new Date(acceptByDate);
      expiresAt.setHours(23, 59, 59, 999);

      // Build email payload similar to receipts
      const businessId = businessData?.id || contractData?.business_id;
      if (!businessId) {
        toast.error('Cannot send email: business ID is missing');
        setSending(false);
        return;
      }

      // Siloed: only link roster members already on THIS business. Never create/link from global email.
      const employeeId = contractData.keyTerms?.employeeEmail
        ? await resolveContractEmployeeId(businessId, contractData.keyTerms)
        : null;

      // Store contract in database
      toast.loading('Storing contract...', { id: 'store-contract' });
      
      // Convert base64 to bytea format for PostgreSQL
      // Use Supabase RPC or convert properly
      const pdfBuffer = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
      
      // Extract required fields from contract data
      const contractStartDate = contractData.keyTerms?.contractStartDate || new Date().toISOString().split('T')[0];
      const positionTitle = contractData.keyTerms?.positionTitle || '';
      const employmentStatus = contractData.keyTerms?.employmentStatus || contractData.keyTerms?.employment_status || 'full-time';
      const contractType = contractData.keyTerms?.employmentType || contractData.keyTerms?.contract_type || 'permanent';
      const wageAmount = parseContractWageAmount(contractData.keyTerms);
      const wageType = contractData.keyTerms?.wageType || 'hourly';
      const employeeAddress = contractData.keyTerms?.employeeAddress || '';
      
      // Calculate probation end date if applicable
      let probationEndDate = null;
      if (contractData.keyTerms?.contractStartDate && contractData.keyTerms?.probationaryPeriod) {
        const startDate = new Date(contractData.keyTerms.contractStartDate);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + (contractData.keyTerms.probationaryPeriod || 90));
        probationEndDate = endDate.toISOString().split('T')[0];
      }

      const contractEndDate = getContractEndDate(contractData.keyTerms);

      const existingContractRow = await resolveExistingContractId(
        businessId,
        toEmail.trim(),
        contractData.finalContract?.id
      );
      const existingContractId = existingContractRow?.id || null;

      const enhancedContractData = mergeContractDataForSave(contractData, existingContractRow);
      enhancedContractData.hr_email = hrEmail.trim() || null;
      enhancedContractData.authorized_representative_email = authorizedRepEmail.trim() || null;
      enhancedContractData.authorized_representative_name = authorizedRepName.trim() || null;

      const contractPayload = {
        business_id: businessId,
        employee_id: employeeId,
        employee_email: toEmail.trim(),
        employee_first_name: contractData.keyTerms?.firstName || '',
        employee_last_name: contractData.keyTerms?.lastName || '',
        employee_address: employeeAddress,
        contract_data: enhancedContractData,
        contract_html: contractHTML,
        pdf_data: pdfBuffer,
        signing_token: signingToken,
        authorized_representative_name: authorizedRepName.trim() || null,
        authorized_representative_email: authorizedRepEmail.trim() || null,
        authorized_representative_signing_token: authorizedRepSigningToken,
        hr_email: hrEmail.trim() || null,
        status: 'sent',
        start_date: contractStartDate,
        expiry_date: contractEndDate,
        end_date: contractEndDate,
        probation_end_date: probationEndDate,
        position_title: positionTitle,
        employment_status: employmentStatus,
        contract_type: contractType,
        wage_amount: wageAmount,
        wage_type: wageType,
        expires_at: expiresAt.toISOString(),
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      let contractRecord;
      let contractError;

      if (existingContractId) {
        console.log('[SendContractModal] Updating existing contract instead of creating duplicate:', existingContractId);
        const updateResult = await supabase
          .from('hr_contracts')
          .update(contractPayload)
          .eq('id', existingContractId)
          .select()
          .single();

        contractRecord = updateResult.data;
        contractError = updateResult.error;
      } else {
        console.log('[SendContractModal] No existing contract found, creating new contract');
        const insertResult = await supabase
          .from('hr_contracts')
          .insert({
            ...contractPayload,
            created_by: authUser?.id || null
          })
          .select()
          .single();

        contractRecord = insertResult.data;
        contractError = insertResult.error;
      }

      if (!contractError && contractRecord?.id) {
        await saveContractSections(contractRecord.id, enhancedContractData.selectedTerms);

        const { error: cleanupError } = await supabase
          .from('hr_contracts')
          .delete()
          .eq('business_id', businessId)
          .eq('employee_email', toEmail.trim())
          .eq('status', 'draft')
          .neq('id', contractRecord.id);

        if (cleanupError) {
          console.warn('[SendContractModal] Failed to clean up duplicate drafts:', cleanupError);
        }
      }

      if (contractError) {
        console.error('Error storing contract:', contractError);
        toast.error('Failed to store contract: ' + contractError.message, { id: 'store-contract' });
        throw contractError;
      }

      toast.dismiss('store-contract');
      toast.dismiss('pdf-generation');
      
      // Format accept by date for email body
      const acceptByDateObj = new Date(acceptByDate);
      const acceptByDateStr = acceptByDateObj.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
      
      // Create signing link
      const frontendUrl = import.meta.env.VITE_FRONTEND_URL || window.location.origin;
      const signingLink = `${frontendUrl}/contract/sign/${signingToken}`;

      // Create email HTML with signing link
      const emailHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${emailSubject}</title>
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
            .email-message {
              margin-bottom: 30px;
              white-space: pre-wrap;
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
            .contract-info {
              background-color: #f9f9f9;
              padding: 15px;
              border-radius: 5px;
              margin: 20px 0;
            }
          </style>
        </head>
        <body>
          <div class="email-wrapper">
            <div class="email-message">${emailBody.replace(/\n/g, '<br>')}</div>
            <div class="contract-info">
              <p><strong>Please review and sign your employment contract by clicking the button below:</strong></p>
              <a href="${signingLink}" class="sign-button" style="color: white; text-decoration: none;">Review & Sign Contract</a>
              <p style="margin-top: 15px; font-size: 13px; color: #666;">
                Or copy and paste this link into your browser:<br>
                <a href="${signingLink}" style="color: #008080; word-break: break-all;">${signingLink}</a>
              </p>
              <p style="margin-top: 15px; font-size: 13px; color: #666;">
                This contract offer will expire on ${acceptByDateStr} at 11:59pm.
              </p>
            </div>
          </div>
        </body>
        </html>
      `;

      // Update email body with accept by date if not already included
      let finalEmailBody = emailBody;
      if (!emailBody.includes('expire') && !emailBody.includes('Accept by') && !emailBody.includes(acceptByDateStr)) {
        finalEmailBody = emailBody + `\n\nThis contract offer will expire on ${acceptByDateStr} at 11:59pm.`;
      } else if (emailBody.includes(acceptByDateStr) && !emailBody.includes('11:59pm')) {
        // Replace date without time with date with time
        finalEmailBody = emailBody.replace(
          new RegExp(`${acceptByDateStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`, 'g'),
          `${acceptByDateStr} at 11:59pm.`
        );
      }

      // Create plain text version for email
      const plainTextBody = finalEmailBody + `\n\n---\nPlease review and sign your employment contract by visiting:\n${signingLink}\n\nThis contract offer will expire on ${acceptByDateStr} at 11:59pm.`;

      // Get sender name: business name with " - HR" suffix for contracts
      // Use business name directly since mail settings may not exist
      // Also check contractData.businessData as fallback for resend scenarios
      console.log('[SendContractModal] Calculating sender name - Input:', {
        'businessData prop exists': !!businessData,
        'businessData.business_name': businessData?.business_name,
        'businessData.name': businessData?.name,
        'contractData exists': !!contractData,
        'contractData.businessData exists': !!contractData?.businessData,
        'contractData.businessData.business_name': contractData?.businessData?.business_name,
        'contractData.businessData.name': contractData?.businessData?.name
      });
      
      const businessName = pickBusinessDisplayName(
        businessData?.name,
        businessData?.business_name,
        contractData?.businessDisplayName,
        contractData?.businessData?.name,
        contractData?.businessData?.business_name
      ) || 'Your Employer';
      const senderName = formatContractHrFromName(businessName);
      
      console.log('[SendContractModal] Sender name calculation result:', {
        businessName,
        senderName,
        finalSenderName: senderName
      });
      
      const emailPayload = {
        businessId: businessId,
        campaignId: `contract-${contractData.keyTerms?.firstName || 'contract'}-${Date.now()}`,
        contactId: `contract-${toEmail.trim()}`,
        emailType: 'transactional',
        to: toEmail.trim(),
        fromEmail: senderEmail,
        fromName: senderName,
        subject: emailSubject,
        html: emailHTML,
        text: plainTextBody
      };

      console.log('[SendContractModal] Email payload being sent:', {
        fromEmail: emailPayload.fromEmail,
        fromName: emailPayload.fromName,
        to: emailPayload.to,
        subject: emailPayload.subject,
        hasFromName: !!emailPayload.fromName,
        fromNameValue: emailPayload.fromName
      });

      // Send email via AWS SES using Supabase Edge Function
      console.log('[SendContractModal] Sending to mail-send function...');
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(emailPayload)
      });
      
      console.log('[SendContractModal] mail-send response status:', response.status);

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('mail-send raw response', response.status, errorBody);
        
        let errorMessage = 'Send failed';
        try {
          const errorData = JSON.parse(errorBody);
          if (errorData?.error?.includes('not verified')) {
            errorMessage = `Email address "${senderEmail}" is not verified in AWS SES. Please verify this email address in AWS SES before sending contracts.`;
          } else {
            errorMessage = errorData?.error || errorBody || 'Send failed';
          }
        } catch (e) {
          errorMessage = errorBody || `Send failed (${response.status})`;
        }
        
        throw new Error(errorMessage);
      }

      const data = await response.json().catch(() => null);
      
      console.log('[SendContractModal] mail-send response data:', {
        ok: data?.ok,
        messageId: data?.messageId,
        fromAddress: data?.fromAddress,
        fromHeader: data?.fromHeader,
        hasDisplayName: data?.hasDisplayName,
        error: data?.error
      });
      
      if (!data?.ok) {
        console.error('mail-send response not ok', data);
        
        let errorMessage = 'Send failed';
        if (data?.error?.includes('not verified')) {
          errorMessage = `Email address "${senderEmail}" is not verified in AWS SES. Please verify this email address in AWS SES before sending contracts.`;
        } else {
          errorMessage = data?.error || 'Send failed';
        }
        
        throw new Error(errorMessage);
      }

      // If CC emails are provided, send copies to all CC recipients
      if (ccEmail && ccEmail.trim()) {
        const ccEmails = ccEmail.split(',').map(email => email.trim()).filter(email => email.length > 0);
        
        // Send to each CC email address
        const ccPromises = ccEmails.map(async (ccEmailAddress) => {
          const ccPayload = {
            ...emailPayload,
            contactId: `contract-cc-${ccEmailAddress}`,
            to: ccEmailAddress,
            fromName: senderName,
            subject: `[CC] ${emailSubject}`
          };

          try {
            await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
                Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
              },
              body: JSON.stringify(ccPayload)
            });
          } catch (ccError) {
            console.warn(`Failed to send CC email to ${ccEmailAddress}:`, ccError);
            // Don't fail the whole operation if CC fails
          }
        });

        // Wait for all CC emails to be sent (but don't fail if some fail)
        await Promise.allSettled(ccPromises);
      }

      toast.success('Contract email sent successfully!');

      // Call onSendComplete if provided
      if (onSendComplete) {
        // Pass the saved contract record and accept by date in the contract data
        const updatedContractData = {
          ...contractData,
          acceptByDate: acceptByDate,
          finalContract: { id: contractRecord.id }, // Include the saved contract ID
          contractRecord: contractRecord // Include the full saved contract record
        };
        await onSendComplete(updatedContractData);
      }

      onClose();
    } catch (error) {
      console.error('Error sending contract:', error);
      toast.error('Failed to send contract: ' + (error.message || 'Unknown error'));
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  const modalStyles = {
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
      zIndex: 1000
    },
    modal: {
      backgroundColor: '#ffffff',
      borderRadius: '8px',
      padding: '24px',
      width: '90%',
      maxWidth: '600px',
      maxHeight: '90vh',
      overflowY: 'auto'
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '20px'
    },
    title: {
      fontSize: '20px',
      fontWeight: 'bold',
      margin: 0
    },
    closeButton: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '4px',
      display: 'flex',
      alignItems: 'center'
    },
    body: {
      marginBottom: '20px'
    },
    formGroup: {
      marginBottom: '16px'
    },
    label: {
      display: 'block',
      marginBottom: '6px',
      fontWeight: '500',
      fontSize: '14px'
    },
    input: {
      width: '100%',
      padding: '8px 12px',
      border: '1px solid #d1d5db',
      borderRadius: '4px',
      fontSize: '14px'
    },
    textarea: {
      width: '100%',
      padding: '8px 12px',
      border: '1px solid #d1d5db',
      borderRadius: '4px',
      fontSize: '14px',
      minHeight: '120px',
      resize: 'vertical',
      fontFamily: 'inherit'
    },
    footer: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '8px',
      marginTop: '24px'
    },
    cancelButton: {
      padding: '10px 20px',
      border: '1px solid #d1d5db',
      borderRadius: '4px',
      backgroundColor: '#ffffff',
      cursor: 'pointer',
      fontSize: '14px'
    },
    sendButton: {
      padding: '10px 20px',
      border: 'none',
      borderRadius: '4px',
      backgroundColor: '#008080',
      color: '#ffffff',
      cursor: 'pointer',
      fontSize: '14px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px'
    }
  };

  return (
    <div style={modalStyles.overlay}>
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>Send Contract</h2>
          <button onClick={onClose} style={modalStyles.closeButton}>
            <X size={24} />
          </button>
        </div>
        
        <div style={modalStyles.body}>
          <div style={modalStyles.formGroup}>
            <label style={modalStyles.label}>To (Employee Email) *</label>
            <input
              type="email"
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              style={modalStyles.input}
              placeholder="employee@example.com"
              required
            />
          </div>
          
          <div style={modalStyles.formGroup}>
            <label style={modalStyles.label}>CC (Optional)</label>
            <input
              type="text"
              value={ccEmail}
              onChange={(e) => setCcEmail(e.target.value)}
              style={modalStyles.input}
              placeholder="cc1@example.com, cc2@example.com"
            />
            <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px', marginBottom: 0 }}>
              Separate multiple emails with commas
            </p>
          </div>
          
          <div style={modalStyles.formGroup}>
            <label style={modalStyles.label}>Authorized Representative Name *</label>
            <input
              type="text"
              value={authorizedRepName}
              onChange={(e) => setAuthorizedRepName(e.target.value)}
              style={modalStyles.input}
              placeholder="John Doe"
              required
            />
            <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px', marginBottom: 0 }}>
              The person who will sign the contract after the employee signs.
            </p>
          </div>
          
          <div style={modalStyles.formGroup}>
            <label style={modalStyles.label}>Authorized Representative Email *</label>
            <input
              type="email"
              value={authorizedRepEmail}
              onChange={(e) => setAuthorizedRepEmail(e.target.value)}
              style={modalStyles.input}
              placeholder="authorized.rep@example.com"
              required
            />
            <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px', marginBottom: 0 }}>
              The authorized representative will receive a signing link after the employee signs.
            </p>
          </div>
          
          <div style={modalStyles.formGroup}>
            <label style={modalStyles.label}>HR Email *</label>
            <input
              type="email"
              value={hrEmail}
              onChange={(e) => setHrEmail(e.target.value)}
              style={modalStyles.input}
              placeholder="hr@example.com"
              required
            />
            <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px', marginBottom: 0 }}>
              The completed contract will be sent to this email after both signatures are complete.
            </p>
          </div>
          
          <div style={modalStyles.formGroup}>
            <label style={modalStyles.label}>Subject</label>
            <input
              type="text"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              style={modalStyles.input}
            />
          </div>
          
          <div style={modalStyles.formGroup}>
            <label style={modalStyles.label}>Accept By Date *</label>
            <input
              type="date"
              value={acceptByDate}
              onChange={(e) => {
                const newDate = e.target.value;
                setAcceptByDate(newDate);
                
                // Update email body to include the accept by date
                if (newDate) {
                  // Parse date string (YYYY-MM-DD) as local date to avoid timezone shifts
                  // Add noon time to prevent timezone conversion issues
                  const [year, month, day] = newDate.split('-').map(Number);
                  const acceptByDateObj = new Date(year, month - 1, day, 12, 0, 0);
                  const acceptByDateStr = acceptByDateObj.toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric',
                    timeZone: 'America/Toronto' // Use business timezone
                  });
                  
                  // Remove old expiration text and add new one
                  let updatedBody = emailBody.replace(/This contract offer will expire on [^.]*\./g, '');
                  updatedBody = updatedBody.replace(/This offer will expire on [^.]*\./g, '');
                  updatedBody = updatedBody.replace(/This contract offer will expire on [^.]* at 11:59pm\./g, '');
                  updatedBody = updatedBody.replace(/This offer will expire on [^.]* at 11:59pm\./g, '');
                  
                  if (!updatedBody.trim().endsWith('.')) {
                    updatedBody = updatedBody.trim() + '.';
                  }
                  
                  updatedBody = updatedBody.trim() + `\n\nThis contract offer will expire on ${acceptByDateStr} at 11:59pm.`;
                  setEmailBody(updatedBody);
                }
              }}
              style={modalStyles.input}
              min={new Date().toISOString().split('T')[0]}
              required
            />
            <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px', marginBottom: 0 }}>
              The employee must accept this contract by this date, or the offer will become void.
            </p>
          </div>
          
          <div style={modalStyles.formGroup}>
            <label style={modalStyles.label}>Message</label>
            <textarea
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              style={modalStyles.textarea}
              placeholder="Email message..."
            />
          </div>
        </div>
        
        <div style={modalStyles.footer}>
          <button onClick={onClose} style={modalStyles.cancelButton}>
            Cancel
          </button>
          <button 
            onClick={handleSend} 
            style={modalStyles.sendButton}
            disabled={sending}
          >
            <Send size={18} />
            {sending ? 'Sending...' : 'Send Contract'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SendContractModal;

