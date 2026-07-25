// components/HR/PolicyEmailModal.jsx
import React, { useState, useEffect } from 'react';
import { X, Mail, Send } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';
import html2pdf from 'html2pdf.js';
import { applyPolicySignatureVariantToHtml, flattenPolicyDocumentForPdfEmbed } from '../../utils/policyHtmlSignatures';

const PolicyEmailModal = ({ isOpen, onClose, policy, businessId, businessData, employees = [] }) => {
  const [sending, setSending] = useState(false);
  const [recipientType, setRecipientType] = useState('employee'); // 'employee' or 'custom'
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [customEmail, setCustomEmail] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [ccEmail, setCcEmail] = useState('');

  // Initialize email content when modal opens
  useEffect(() => {
    if (isOpen && policy) {
      const businessName = businessData?.business_name || businessData?.name || 'Company';
      setEmailSubject(`Policy Document - ${policy.policy_name}`);
      setEmailBody(`Dear Employee,

Please find attached the policy document: ${policy.policy_name}.

Please review this policy document carefully. ${policy.requires_acknowledgment ? 'You will be required to acknowledge receipt of this policy.' : ''}

If you have any questions, please contact your HR department.

Best regards,
${businessName} - HR`);
    }
  }, [isOpen, policy, businessData]);

  const handleSend = async () => {
    // Validation
    let recipientEmail = '';
    
    if (recipientType === 'employee') {
      if (!selectedEmployeeId) {
        toast.error('Please select an employee');
        return;
      }
      const employee = employees.find(emp => emp.id === selectedEmployeeId);
      if (!employee || !employee.email) {
        toast.error('Selected employee does not have an email address');
        return;
      }
      recipientEmail = employee.email;
    } else {
      if (!customEmail.trim()) {
        toast.error('Please enter an email address');
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(customEmail.trim())) {
        toast.error('Please enter a valid email address');
        return;
      }
      recipientEmail = customEmail.trim();
    }

    if (!emailSubject.trim()) {
      toast.error('Email subject is required');
      return;
    }

    if (!emailBody.trim()) {
      toast.error('Email body is required');
      return;
    }

    if (ccEmail && ccEmail.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(ccEmail.trim())) {
        toast.error('Please enter a valid CC email address');
        return;
      }
    }

    setSending(true);
    try {
      toast.loading('Generating PDF...', { id: 'pdf-generation' });

      // Refetch policy so version and dates are current
      const { data: freshPolicy, error: fetchErr } = await supabase
        .from('hr_policies')
        .select('id, policy_name, policy_html, policy_version, effective_date, revised_date, updated_at')
        .eq('id', policy.id)
        .single();
      if (fetchErr || !freshPolicy?.policy_html) {
        toast.dismiss('pdf-generation');
        setSending(false);
        throw new Error(freshPolicy?.policy_html ? 'Failed to load latest policy details' : 'Policy HTML not available');
      }
      const policyForPdf = { ...policy, ...freshPolicy };
      const policyHtmlMerged = applyPolicySignatureVariantToHtml(policyForPdf.policy_html, 'acknowledgment');
      const { bodyHtml, headStyleText } = flattenPolicyDocumentForPdfEmbed(policyHtmlMerged);

      const LETTER_WIDTH_PX = 816;
      const fullWidthCss = [
        '#policy-pdf-root{width:' + LETTER_WIDTH_PX + 'px !important;min-width:' + LETTER_WIDTH_PX + 'px !important;max-width:none !important;box-sizing:border-box !important}',
        '#policy-pdf-root body,#policy-pdf-root .page-container{width:100% !important;min-width:' + LETTER_WIDTH_PX + 'px !important;max-width:none !important;box-sizing:border-box !important;overflow:visible !important;max-height:none !important;height:auto !important}',
        '#policy-pdf-root .page-container{padding:0.4in 1.1in 0.5in 0.35in !important}',
        '#policy-pdf-root{overflow:visible !important}',
        '#policy-pdf-root *{box-sizing:border-box !important}',
        '#policy-pdf-root .content,#policy-pdf-root .header,#policy-pdf-root .category-section{max-width:none !important;width:100% !important}',
        '#policy-pdf-root .header-title-row{display:flex !important;align-items:baseline !important;gap:12px !important}#policy-pdf-root .header .policy-title{flex:1 !important;min-width:0 !important}#policy-pdf-root .policy-meta-footer{margin-top:48px !important;padding-top:24px !important;border-top:1px solid #e5e7eb !important;display:flex !important;flex-wrap:wrap !important;gap:24px 32px !important}',
        '#policy-pdf-root .right-border{text-orientation:sideways !important}',
        '#policy-pdf-root table[data-tavari-sig-table="1"]{display:table!important;visibility:visible!important;opacity:1!important;border-collapse:collapse!important}',
        '#policy-pdf-root table[data-tavari-sig-table="1"] tr:nth-child(1) td,#policy-pdf-root table[data-tavari-sig-table="1"] tr:nth-child(4) td{min-height:14px!important;height:auto!important;line-height:1.2!important;font-size: 11px!important;border-bottom:3px solid #000000!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}',
        '#policy-pdf-root table[data-tavari-sig-table="1"] td{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}'
      ].join('');
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML =
        '<style>' + fullWidthCss + (headStyleText ? '\n' + headStyleText : '') + '</style>' +
        '<div id="policy-pdf-root">' + bodyHtml + '</div>';
      tempDiv.style.cssText = `
        position: absolute; left: 0; top: 0;
        width: ${LETTER_WIDTH_PX}px; min-height: 11in;
        background: #fff; visibility: visible; z-index: -1000;
        font-family: Arial, sans-serif;
      `;
      document.body.appendChild(tempDiv);

      const root = tempDiv.querySelector('#policy-pdf-root');
      const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '');
      const effectiveStr = formatDate(policyForPdf.effective_date);
      const revisedStr = formatDate(policyForPdf.revised_date);
      const updatedStr = formatDate(policyForPdf.updated_at);
      const versionStr = String(policyForPdf.policy_version ?? '1.0');
      const setMetaByLabel = (container, labelText, value) => {
        if (!container || value === undefined || value === null) return;
        container.querySelectorAll('.meta-item').forEach((item) => {
          const label = item.querySelector('.meta-label');
          if (label && label.textContent.trim().toLowerCase().startsWith(labelText.toLowerCase())) {
            const valSpan = item.querySelector('span:last-child');
            if (valSpan) valSpan.textContent = value;
          }
        });
      };
      const updateMetaContainers = (c) => {
        if (!c) return;
        setMetaByLabel(c, 'Effective Date', effectiveStr);
        setMetaByLabel(c, 'Revised Date', revisedStr);
        setMetaByLabel(c, 'Last Updated', updatedStr);
        setMetaByLabel(c, 'Version', versionStr);
      };
      if (root) {
        updateMetaContainers(root.querySelector('.policy-meta-footer'));
        updateMetaContainers(root.querySelector('.header .policy-meta'));
        const rightBorder = root.querySelector('.right-border');
        if (rightBorder) rightBorder.textContent = '';
        const titleEl = root.querySelector('.policy-title');
        if (titleEl) titleEl.textContent = 'Policy: ' + (policyForPdf.policy_name || '').trim();
        const labelEl = root.querySelector('.policy-label');
        if (labelEl) labelEl.remove();
      }

      tempDiv.style.overflow = 'visible';
      if (root) root.style.overflow = 'visible';
      tempDiv.offsetHeight;
      await new Promise(resolve => setTimeout(resolve, 500));
      tempDiv.offsetHeight;
      const minLetterHeightPx = Math.round(11 * 96);
      const contentWidth = Math.max(tempDiv.scrollWidth, root?.scrollWidth || 0, LETTER_WIDTH_PX);
      const contentHeight = Math.max(tempDiv.scrollHeight, root?.scrollHeight || 0, minLetterHeightPx);

      let pdfBase64;
      try {
        const opt = {
          margin: [0.25, 0.25, 0.25, 0.25],
          filename: `${policyForPdf.policy_name.replace(/[^a-z0-9]/gi, '_')}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            logging: false,
            letterRendering: true,
            allowTaint: true,
            backgroundColor: '#ffffff',
            width: contentWidth,
            height: contentHeight,
            windowWidth: contentWidth,
            windowHeight: contentHeight,
            scrollX: 0,
            scrollY: 0
          },
          jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', 'pre', 'img'] }
        };
        const pdfBlob = await html2pdf().set(opt).from(tempDiv).outputPdf('blob');
        
        // Clean up
        if (document.body.contains(tempDiv)) {
          document.body.removeChild(tempDiv);
        }
        
        console.log('[PDF-EMAIL] PDF blob created:', {
          size: pdfBlob.size,
          type: pdfBlob.type,
          isValid: pdfBlob instanceof Blob
        });
        
        // Validate PDF blob
        if (!pdfBlob || pdfBlob.size === 0) {
          throw new Error('PDF blob is empty or invalid');
        }
        
        if (pdfBlob.size < 1000) {
          throw new Error('PDF appears to be corrupted (file too small)');
        }

        // Convert PDF to base64
        pdfBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64String = reader.result.split(',')[1];
            resolve(base64String);
          };
          reader.onerror = reject;
          reader.readAsDataURL(pdfBlob);
        });
        
        toast.dismiss('pdf-generation');
      } catch (pdfError) {
        // Clean up temporary element if it still exists
        if (document.body.contains(tempDiv)) {
          document.body.removeChild(tempDiv);
        }
        console.error('[PDF-EMAIL] Error generating PDF:', pdfError);
        toast.error('Failed to generate PDF. Please try again.', { id: 'pdf-generation' });
        throw pdfError;
      }

      toast.dismiss('pdf-generation');

      // Create policy assignment record if employee was selected
      if (recipientType === 'employee' && selectedEmployeeId) {
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + (policy.acknowledgment_deadline_days || 30));

        const { error: assignmentError } = await supabase
          .from('hr_policy_assignments')
          .insert({
            policy_id: policy.id,
            employee_id: selectedEmployeeId,
            assigned_by: (await supabase.auth.getUser()).data.user?.id,
            due_date: dueDate.toISOString().split('T')[0],
            acknowledged: false
          });

        if (assignmentError) {
          console.error('Error creating policy assignment:', assignmentError);
          // Don't fail the whole operation if assignment creation fails
        }
      }

      // Prepare email payload
      const businessName = businessData?.business_name || businessData?.name || 'Company';
      const senderEmail = 'noreply@tavarios.ca'; // Same as contracts
      const senderName = `${businessName} - HR`;

      // Create email HTML
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
          </style>
        </head>
        <body>
          <div class="email-wrapper">
            <div class="email-message">${emailBody.replace(/\n/g, '<br>')}</div>
          </div>
        </body>
        </html>
      `;

      const emailPayload = {
        businessId: businessId,
        campaignId: `policy-${policy.id}-${Date.now()}`,
        contactId: `policy-${recipientEmail}`,
        emailType: 'transactional',
        to: recipientEmail,
        fromEmail: senderEmail,
        fromName: senderName,
        subject: emailSubject,
        html: emailHTML,
        text: emailBody,
        attachments: [
          {
            filename: `${policy.policy_name.replace(/[^a-z0-9]/gi, '_')}.pdf`,
            content: pdfBase64,
            contentType: 'application/pdf'
          }
        ]
      };

      // Send email via AWS SES using Supabase Edge Function
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(emailPayload)
      });

      if (!response.ok) {
        const errorBody = await response.text();
        let errorMessage = 'Send failed';
        try {
          const errorData = JSON.parse(errorBody);
          if (errorData?.error?.includes('not verified')) {
            errorMessage = `Email address "${senderEmail}" is not verified in AWS SES.`;
          } else {
            errorMessage = errorData?.error || errorBody || 'Send failed';
          }
        } catch (e) {
          errorMessage = errorBody || `Send failed (${response.status})`;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json().catch(() => null);

      if (!data?.ok) {
        let errorMessage = 'Send failed';
        if (data?.error?.includes('not verified')) {
          errorMessage = `Email address "${senderEmail}" is not verified in AWS SES.`;
        } else {
          errorMessage = data?.error || 'Send failed';
        }
        throw new Error(errorMessage);
      }

      // Send CC email if provided
      if (ccEmail && ccEmail.trim()) {
        const ccPayload = {
          ...emailPayload,
          contactId: `policy-cc-${ccEmail.trim()}`,
          to: ccEmail.trim(),
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
          console.warn('Failed to send CC email:', ccError);
          // Don't fail the whole operation if CC fails
        }
      }

      toast.success('Policy email sent successfully!');
      onClose();
    } catch (error) {
      console.error('Error sending policy email:', error);
      toast.error('Failed to send email: ' + (error.message || 'Unknown error'));
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

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
      margin: 0,
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    },
    closeButton: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '4px',
      display: 'flex',
      alignItems: 'center'
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
      fontSize: '14px',
      boxSizing: 'border-box'
    },
    select: {
      width: '100%',
      padding: '8px 12px',
      border: '1px solid #d1d5db',
      borderRadius: '4px',
      fontSize: '14px',
      boxSizing: 'border-box',
      backgroundColor: 'white'
    },
    textarea: {
      width: '100%',
      padding: '8px 12px',
      border: '1px solid #d1d5db',
      borderRadius: '4px',
      fontSize: '14px',
      minHeight: '120px',
      resize: 'vertical',
      fontFamily: 'inherit',
      boxSizing: 'border-box'
    },
    radioGroup: {
      display: 'flex',
      gap: '20px',
      marginBottom: '16px'
    },
    radioOption: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      cursor: 'pointer'
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
      backgroundColor: '#14B8A6',
      color: '#ffffff',
      cursor: 'pointer',
      fontSize: '14px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px'
    }
  };

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>
            <Mail size={20} />
            Email Policy
          </h2>
          <button onClick={onClose} style={styles.closeButton}>
            <X size={24} />
          </button>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Recipient Type</label>
          <div style={styles.radioGroup}>
            <label style={styles.radioOption}>
              <input
                type="radio"
                value="employee"
                checked={recipientType === 'employee'}
                onChange={(e) => setRecipientType(e.target.value)}
              />
              Employee
            </label>
            <label style={styles.radioOption}>
              <input
                type="radio"
                value="custom"
                checked={recipientType === 'custom'}
                onChange={(e) => setRecipientType(e.target.value)}
              />
              Custom Email
            </label>
          </div>
        </div>

        {recipientType === 'employee' ? (
          <div style={styles.formGroup}>
            <label style={styles.label}>Select Employee *</label>
            <select
              value={selectedEmployeeId}
              onChange={(e) => setSelectedEmployeeId(e.target.value)}
              style={styles.select}
            >
              <option value="">Choose an employee...</option>
              {employees
                .filter(emp => emp.email)
                .map(emp => (
                  <option key={emp.id} value={emp.id}>
                    {emp.first_name} {emp.last_name} ({emp.email})
                  </option>
                ))}
            </select>
          </div>
        ) : (
          <div style={styles.formGroup}>
            <label style={styles.label}>Email Address *</label>
            <input
              type="email"
              value={customEmail}
              onChange={(e) => setCustomEmail(e.target.value)}
              style={styles.input}
              placeholder="recipient@example.com"
            />
          </div>
        )}

        <div style={styles.formGroup}>
          <label style={styles.label}>CC (Optional)</label>
          <input
            type="email"
            value={ccEmail}
            onChange={(e) => setCcEmail(e.target.value)}
            style={styles.input}
            placeholder="cc@example.com"
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Subject *</label>
          <input
            type="text"
            value={emailSubject}
            onChange={(e) => setEmailSubject(e.target.value)}
            style={styles.input}
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Message *</label>
          <textarea
            value={emailBody}
            onChange={(e) => setEmailBody(e.target.value)}
            style={styles.textarea}
          />
        </div>

        <div style={styles.footer}>
          <button onClick={onClose} style={styles.cancelButton}>
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            style={{
              ...styles.sendButton,
              opacity: sending ? 0.6 : 1
            }}
          >
            <Send size={18} />
            {sending ? 'Sending...' : 'Send Email'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PolicyEmailModal;


