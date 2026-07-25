// components/HR/ResendEmailModal.jsx
import React, { useState, useEffect } from 'react';
import { X, Mail, Send } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';
import html2pdf from 'html2pdf.js';

const ResendEmailModal = ({ 
  isOpen, 
  onClose, 
  terminationId,
  businessId,
  onEmailSent
}) => {
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [terminationData, setTerminationData] = useState(null);
  const [employeeData, setEmployeeData] = useState(null);
  const [businessData, setBusinessData] = useState(null);
  const [emailTo, setEmailTo] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [sending, setSending] = useState(false);

  // Load termination data when modal opens
  useEffect(() => {
    if (isOpen && terminationId && businessId) {
      loadTerminationData();
    }
  }, [isOpen, terminationId, businessId]);

  const loadTerminationData = async () => {
    setLoadingData(true);
    try {
      // Load termination
      const { data: termData, error: termError } = await supabase
        .from('hr_terminations')
        .select('*')
        .eq('id', terminationId)
        .single();

      if (termError) throw termError;

      setTerminationData(termData);

      // Load employee
      let empData = null;
      if (termData.employee_id) {
        const { data: empDataResult, error: empError } = await supabase
          .from('users')
          .select('id, first_name, last_name, email, position, hire_date, start_date')
          .eq('id', termData.employee_id)
          .single();

        if (!empError && empDataResult) {
          empData = empDataResult;
          setEmployeeData(empData);
        }
      }

      // Load business
      const { data: busData, error: busError } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', businessId)
        .single();

      if (!busError && busData) {
        setBusinessData(busData);
      }

      // Set email fields from termination data (use loaded empData)
      setEmailTo(termData.email_to || (empData?.email || ''));
      setEmailCc(termData.email_cc || '');

    } catch (error) {
      console.error('Error loading termination data:', error);
      toast.error('Failed to load termination data');
    } finally {
      setLoadingData(false);
    }
  };

  const generateTerminationNoticeHTML = () => {
    if (!employeeData || !terminationData) return '';

    const businessTimezone = businessData?.timezone || 'America/Toronto';
    const terminationDate = new Date(terminationData.termination_date + 'T12:00:00Z');
    
    const formattedDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: businessTimezone,
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(terminationDate);

    const businessName = businessData?.business_name || businessData?.name || '[THE BUSINESS]';
    const businessAddress = businessData?.business_address || businessData?.address || '';
    const businessCity = businessData?.business_city || businessData?.city || '';
    const businessState = businessData?.business_state || businessData?.state || 'ON';
    const businessPostal = businessData?.business_postal || businessData?.postal_code || '';
    const businessEmail = businessData?.business_email || businessData?.email || '[COMPANY EMAIL]';
    const fullBusinessAddress = businessAddress 
      ? `${businessAddress}${businessCity ? `, ${businessCity}` : ''}${businessState ? `, ${businessState}` : ''}${businessPostal ? ` ${businessPostal}` : ''}`
      : '[BUSINESS ADDRESS]';

    // Get template name
    let templateName = 'TERMINATION NOTICE';
    if (terminationData.termination_type === 'with_cause') {
      templateName = 'TERMINATION NOTICE – WITH CAUSE';
    } else if (terminationData.termination_type === 'without_cause') {
      templateName = 'TERMINATION NOTICE – WITHOUT CAUSE';
    } else if (terminationData.termination_type === 'layoff') {
      templateName = 'LAYOFF NOTICE';
    }

    // Body content
    let bodyContent = terminationData.notice_body || '';

    // Replace placeholders
    bodyContent = bodyContent
      .replace(/\{\{EmployeeFirstName\}\}/g, employeeData.first_name || '')
      .replace(/\{\{EmployeeLastName\}\}/g, employeeData.last_name || '')
      .replace(/\{\{EmployeeFullName\}\}/g, `${employeeData.first_name || ''} ${employeeData.last_name || ''}`.trim())
      .replace(/\{\{EmployeePosition\}\}/g, employeeData.position || 'N/A')
      .replace(/\{\{EmployeeAddress\}\}/g, terminationData.employee_address || 'N/A')
      .replace(/\{\{EmployeeEmail\}\}/g, employeeData.email || 'N/A')
      .replace(/\{\{StartDate\}\}/g, (() => {
        const startDate = new Date(employeeData.hire_date || employeeData.start_date);
        return new Intl.DateTimeFormat('en-CA', {
          timeZone: businessTimezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(startDate);
      })())
      .replace(/\{\{TerminationDate\}\}/g, formattedDate)
      .replace(/\{\{TerminationDateShort\}\}/g, terminationDate.toISOString().split('T')[0])
      .replace(/\{\{Cause\}\}/g, terminationData.cause || '')
      .replace(/\{\{BusinessName\}\}/g, businessName)
      .replace(/\{\{BusinessAddress\}\}/g, fullBusinessAddress)
      .replace(/\{\{BusinessEmail\}\}/g, businessEmail)
      .replace(/\{\{THE BUSINESS\}\}/g, businessName)
      .replace(/\{\{COMPANY EMAIL\}\}/g, businessEmail)
      .replace(/\{\{ManagerName\}\}/g, terminationData.manager_name || '[Manager Name]')
      .replace(/\{\{ManagerTitle\}\}/g, terminationData.manager_title || '[Manager Title]');

    // ESA Details Section
    let esaDetailsSection = '';
    const finalPay = terminationData.final_pay || 0;
    const vacationPay = terminationData.vacation_pay_owed || 0;

    if (terminationData.termination_type === 'without_cause' || terminationData.termination_type === 'with_cause') {
      esaDetailsSection = `
        <div class="esa-details">
          <p style="font-weight: bold; margin-bottom: 8px;">Final Compensation and Statutory Entitlements</p>
          <p style="margin-bottom: 8px;">In accordance with the ESA, you will receive:</p>
          <ul style="margin-left: 20px; padding-left: 20px;">
            <li style="margin-bottom: 6px;"><strong>Final Wages:</strong> Payment for all hours worked up to and including your final shift${finalPay > 0 ? ` ($${finalPay.toFixed(2)})` : ''}.</li>
            <li style="margin-bottom: 6px;"><strong>Vacation Pay:</strong> ${vacationPay > 0 ? `$${vacationPay.toFixed(2)} in vacation pay owed` : 'As vacation pay is paid with each pay period, no additional vacation pay is owing'}.</li>
            <li style="margin-bottom: 6px;"><strong>Record of Employment:</strong> Your ROE will be issued electronically through Service Canada.</li>
          </ul>
        </div>
      `;
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body {
            font-family: "Times New Roman", serif;
            line-height: 1.5;
            color: #000;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px 40px;
          }
          .company-info {
            margin-bottom: 12px;
          }
          .date {
            margin-bottom: 12px;
          }
          .recipient-info {
            margin-bottom: 12px;
          }
          .salutation {
            margin-bottom: 10px;
          }
          .subject {
            font-weight: bold;
            margin-bottom: 10px;
          }
          .body-content {
            margin-bottom: 12px;
            white-space: pre-wrap;
            line-height: 1.6;
          }
          .esa-details {
            margin-top: 12px;
            margin-bottom: 12px;
          }
          .closing {
            margin-top: 20px;
          }
          .signature {
            margin-top: 25px;
          }
        </style>
      </head>
      <body>
        <div class="company-info">
          <strong>${businessName}</strong><br>
          ${fullBusinessAddress}<br>
          ${businessEmail}
        </div>
        <div class="date">
          <strong>Date:</strong> ${formattedDate}
        </div>
        <div class="recipient-info">
          <strong>To:</strong> ${employeeData.first_name} ${employeeData.last_name}<br>
          <strong>Address:</strong> ${terminationData.employee_address || 'N/A'}<br>
          <strong>Email:</strong> ${employeeData.email || 'N/A'}
        </div>
        <div class="subject">
          Subject: ${terminationData.subject_line || 'Termination of Employment'}
        </div>
        <div class="body-content">${bodyContent.replace(/\n/g, '<br>')}</div>
        ${esaDetailsSection}
        <div class="closing">
          Sincerely,
        </div>
        <div class="signature">
          <br><br>
          _________________________<br>
          ${terminationData.manager_name || '[Manager Name]'}<br>
          ${terminationData.manager_title || '[Manager Title]'}<br>
          ${businessName}
        </div>
      </body>
      </html>
    `;
  };

  const handleResendEmail = async () => {
    if (!emailTo.trim()) {
      toast.error('Please enter at least one email address');
      return;
    }

      console.log('[ResendEmailModal] ========== EMAIL SENDING DEBUG ==========');
      console.log('[ResendEmailModal] Raw email fields:', {
        emailTo: emailTo,
        emailCc: emailCc,
        hasEmailTo: !!emailTo,
        hasEmailCc: !!emailCc
      });

      const toEmails = emailTo
        .split(',')
        .map(email => email.trim())
        .filter(email => email && email.includes('@'));

      console.log('[ResendEmailModal] Parsed TO emails:', toEmails);

      if (toEmails.length === 0) {
        toast.error('Please enter valid email addresses');
        return;
      }

      setSending(true);
      try {
      // Validate required data
      if (!employeeData || !terminationData) {
        throw new Error('Missing employee or termination data. Please try again.');
      }

      // Generate PDF
      const htmlContent = generateTerminationNoticeHTML();
      
      if (!htmlContent || htmlContent.trim() === '') {
        throw new Error('Failed to generate termination notice content. Please check that all required fields are present.');
      }

      console.log('[ResendEmailModal] Generating PDF with HTML content length:', htmlContent.length);
      console.log('[ResendEmailModal] Termination data:', {
        hasNoticeBody: !!terminationData.notice_body,
        noticeBodyLength: terminationData.notice_body?.length || 0,
        hasManagerName: !!terminationData.manager_name,
        hasManagerTitle: !!terminationData.manager_title,
        hasSubjectLine: !!terminationData.subject_line
      });

      const opt = {
        margin: [0.3, 0.5, 0.3, 0.5],
        filename: `Termination Notice - ${employeeData.first_name} ${employeeData.last_name}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
      };

      const pdfBlob = await html2pdf().set(opt).from(htmlContent).outputPdf('blob');
      
      if (!pdfBlob || pdfBlob.size === 0) {
        throw new Error('Failed to generate PDF. The PDF file is empty.');
      }
      
      console.log('[ResendEmailModal] PDF generated successfully, size:', pdfBlob.size, 'bytes');
      const pdfBase64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(pdfBlob);
      });

      // Prepare email
      const businessName = businessData?.business_name || businessData?.name || 'Company';
      const emailSubject = terminationData.subject_line || `Termination Notice - ${employeeData.first_name} ${employeeData.last_name}`;
      const employeeFirstName = employeeData?.first_name?.trim() || 'Employee';
      
      const emailBody = `Dear ${employeeFirstName},\n\nPlease find attached your termination notice.\n\nIf you have any questions, please contact HR.\n\nBest regards,\n${businessName} - HR`;

      const emailHTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px;">
  <p>Dear ${employeeFirstName},</p>
  <p>Please find attached your termination notice.</p>
  <p>If you have any questions, please contact HR.</p>
  <p>Best regards,<br>${businessName} - HR</p>
</body>
</html>`;

      const ccEmails = emailCc && emailCc.trim()
        ? emailCc
            .split(',')
            .map(email => email.trim())
            .filter(email => email && email.includes('@'))
        : [];
      
      console.log('[ResendEmailModal] Parsed CC emails:', ccEmails);
      console.log('[ResendEmailModal] CC emails count:', ccEmails.length);

      // Send email
      const senderEmail = 'noreply@tavarios.ca';
      const emailPayload = {
        businessId: businessId,
        campaignId: `termination-resend-${terminationId}-${Date.now()}`,
        contactId: `termination-${toEmails[0]}`,
        emailType: 'transactional',
        to: toEmails.join(','),
        fromEmail: senderEmail,
        fromName: `${businessName} - HR`,
        subject: emailSubject,
        html: emailHTML,
        text: emailBody,
        attachments: [{
          filename: `Termination Notice - ${employeeData.first_name} ${employeeData.last_name}.pdf`,
          content: pdfBase64,
          contentType: 'application/pdf'
        }]
      };

      // Ensure CC is in the payload if there are CC emails
      const finalPayload = {
        ...emailPayload
      };
      
      console.log('[ResendEmailModal] Email payload before adding CC:', {
        hasCc: 'cc' in finalPayload,
        ccValue: finalPayload.cc,
        allKeys: Object.keys(finalPayload)
      });

      if (ccEmails.length > 0) {
        finalPayload.cc = ccEmails.join(',');
        console.log('[ResendEmailModal] ✅ CC emails being added to payload:', ccEmails);
        console.log('[ResendEmailModal] ✅ CC field value:', finalPayload.cc);
        console.log('[ResendEmailModal] ✅ CC field type:', typeof finalPayload.cc);
      } else {
        console.log('[ResendEmailModal] ⚠️ No CC emails to add (ccEmails.length = 0)');
      }

      console.log('[ResendEmailModal] Final email payload before sending:', {
        to: finalPayload.to,
        cc: finalPayload.cc,
        hasCc: 'cc' in finalPayload,
        ccValue: finalPayload.cc,
        ccType: typeof finalPayload.cc,
        hasAttachments: finalPayload.attachments?.length > 0,
        allKeys: Object.keys(finalPayload),
        payloadStringified: JSON.stringify(finalPayload, null, 2)
      });

      const requestBody = JSON.stringify(finalPayload);
      console.log('[ResendEmailModal] Request body being sent:', {
        bodyLength: requestBody.length,
        bodyPreview: requestBody.substring(0, 500),
        hasCcInBody: requestBody.includes('"cc"'),
        ccInBody: requestBody.match(/"cc"\s*:\s*"([^"]+)"/)?.[1]
      });

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: requestBody
      });

      console.log('[ResendEmailModal] Response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(errorBody || 'Failed to send email');
      }

      const data = await response.json();
      if (!data?.ok) {
        throw new Error(data?.error || 'Failed to send email');
      }

      // If CC emails are provided, send copies to all CC recipients (same pattern as contracts)
      if (ccEmails.length > 0) {
        console.log('[ResendEmailModal] Sending separate emails to CC recipients:', ccEmails);
        
        const ccPromises = ccEmails.map(async (ccEmailAddress) => {
          const ccPayload = {
            ...finalPayload,
            contactId: `termination-resend-cc-${ccEmailAddress}-${Date.now()}`,
            to: ccEmailAddress,
            subject: `[CC] ${emailSubject}`
          };
          // Remove CC field from individual CC emails to avoid recursion
          delete ccPayload.cc;

          try {
            const ccResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
                Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
              },
              body: JSON.stringify(ccPayload)
            });

            if (!ccResponse.ok) {
              const errorBody = await ccResponse.text();
              console.warn(`[ResendEmailModal] Failed to send CC email to ${ccEmailAddress}:`, errorBody);
            } else {
              const ccData = await ccResponse.json();
              if (!ccData?.ok) {
                console.warn(`[ResendEmailModal] CC email to ${ccEmailAddress} failed:`, ccData?.error);
              } else {
                console.log(`[ResendEmailModal] ✅ CC email sent successfully to ${ccEmailAddress}`);
              }
            }
          } catch (ccError) {
            console.warn(`[ResendEmailModal] Failed to send CC email to ${ccEmailAddress}:`, ccError);
            // Don't fail the whole operation if CC fails
          }
        });

        // Wait for all CC emails to be sent (but don't fail if some fail)
        await Promise.allSettled(ccPromises);
        console.log('[ResendEmailModal] All CC emails processed');
      }

      // Update termination record with new email addresses
      console.log('[ResendEmailModal] Updating termination record:', {
        terminationId: terminationId,
        emailTo: emailTo,
        emailCc: emailCc || null
      });
      
      const { error: updateError } = await supabase
        .from('hr_terminations')
        .update({
          email_to: emailTo,
          email_cc: emailCc || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', terminationId);
      
      if (updateError) {
        console.error('[ResendEmailModal] Error updating termination record:', updateError);
        // Don't throw - email was sent successfully, this is just a database update
        toast.error('Email sent successfully, but failed to update record: ' + updateError.message);
      } else {
        console.log('[ResendEmailModal] ✅ Termination record updated successfully');
      }

      toast.success(`Email resent to ${toEmails.join(', ')}${ccEmails.length > 0 ? ` (CC: ${ccEmails.join(', ')})` : ''}`);
      onEmailSent();

    } catch (error) {
      console.error('Error resending email:', error);
      toast.error('Failed to resend email: ' + (error.message || 'Unknown error'));
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  return (
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
    }}
    onClick={(e) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    }}
    >
      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '24px',
        maxWidth: '600px',
        width: '90%',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)'
      }}
      onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px'
        }}>
          <h2 style={{
            fontSize: '24px',
            fontWeight: 'bold',
            color: '#111827',
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Mail size={24} />
            Resend Termination Email
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '24px',
              cursor: 'pointer',
              color: '#6b7280',
              padding: '0',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {loadingData ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              border: '3px solid #3b82f6',
              borderTop: '3px solid transparent',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 16px'
            }}></div>
            <p style={{ color: '#6b7280' }}>Loading termination data...</p>
          </div>
        ) : (
          <>
            {employeeData && (
              <div style={{
                backgroundColor: '#f9fafb',
                padding: '16px',
                borderRadius: '8px',
                marginBottom: '20px'
              }}>
                <p style={{ margin: '0 0 8px 0', fontWeight: '600', color: '#374151' }}>
                  Employee: {employeeData.first_name} {employeeData.last_name}
                </p>
                <p style={{ margin: 0, fontSize: '14px', color: '#6b7280' }}>
                  Termination Date: {new Date(terminationData?.termination_date).toLocaleDateString('en-CA')}
                </p>
              </div>
            )}

            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '6px'
              }}>
                To (Email Addresses) *
              </label>
              <input
                type="text"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="email@example.com, another@example.com"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '2px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '16px',
                  outline: 'none'
                }}
                disabled={sending}
              />
              <p style={{
                margin: '6px 0 0 0',
                fontSize: '13px',
                color: '#6b7280'
              }}>
                Separate multiple email addresses with commas
              </p>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '6px'
              }}>
                CC (Optional)
              </label>
              <input
                type="text"
                value={emailCc}
                onChange={(e) => setEmailCc(e.target.value)}
                placeholder="manager@example.com, hr@example.com"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '2px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '16px',
                  outline: 'none'
                }}
                disabled={sending}
              />
              <p style={{
                margin: '6px 0 0 0',
                fontSize: '13px',
                color: '#6b7280'
              }}>
                Separate multiple email addresses with commas
              </p>
            </div>

            <div style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'flex-end'
            }}>
              <button
                onClick={onClose}
                disabled={sending}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#e5e7eb',
                  color: '#374151',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: sending ? 'not-allowed' : 'pointer',
                  opacity: sending ? 0.6 : 1
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleResendEmail}
                disabled={sending || !emailTo.trim()}
                style={{
                  padding: '10px 20px',
                  backgroundColor: sending ? '#9ca3af' : '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: (sending || !emailTo.trim()) ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                {sending ? (
                  <>
                    <div style={{
                      width: '16px',
                      height: '16px',
                      border: '2px solid white',
                      borderTop: '2px solid transparent',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite'
                    }}></div>
                    Sending...
                  </>
                ) : (
                  <>
                    <Send size={16} />
                    Resend Email
                  </>
                )}
              </button>
            </div>
          </>
        )}

        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  );
};

export default ResendEmailModal;

