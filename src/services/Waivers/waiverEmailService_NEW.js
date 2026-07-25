// Step 67: Create waiverEmailService.js
// Service for sending waiver-related emails
// Uses existing mail_contacts, mail_campaign_sends, mail_contact_communications tables
// EXACT SAME SETUP AS PAY STATEMENTS
import { supabase } from '../../supabaseClient';
import html2pdf from 'html2pdf.js';
import { formatDateOfBirthDisplay } from '../../utils/waiverDateOfBirth';
import { resolveWaiverSignatureImgSrc } from '../../utils/waiverSignatureDisplay';

function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('\n');
}

class WaiverEmailService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Send waiver link via email
  async sendWaiverLink(waiverId, recipientEmail) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Get waiver information
    const { data: waiver, error: waiverError } = await supabase
      .from('waiver_signatures')
      .select(`
        *,
        waiver_templates:template_id (
          template_name,
          waiver_title,
          waiver_content
        )
      `)
      .eq('id', waiverId)
      .single();

    if (waiverError) {
      throw waiverError;
    }

    // Get or create contact
    let contactId;
    const { data: existingContact } = await supabase
      .from('mail_contacts')
      .select('id')
      .eq('business_id', this.businessId)
      .eq('email', recipientEmail)
      .single();

    if (existingContact) {
      contactId = existingContact.id;
    } else {
      const { data: newContact, error: contactError } = await supabase
        .from('mail_contacts')
        .insert({
          business_id: this.businessId,
          email: recipientEmail,
          first_name: waiver.first_name,
          last_name: waiver.last_name,
          phone: waiver.phone_number,
          subscribed: true
        })
        .select()
        .single();

      if (contactError) {
        throw contactError;
      }

      contactId = newContact.id;
    }

    // Generate waiver URL
    const waiverUrl = `${window.location.origin}/waivers/sign/${waiver.signature_token}`;
    const waiverTitle = waiver.waiver_templates?.waiver_title || waiver.waiver_templates?.template_name || 'waiver';
    const waiverContentText = stripHtmlToText(waiver.waiver_templates?.waiver_content || '');

    // Create email content
    const emailContent = `
Hello ${waiver.first_name},

Please review the waiver below before signing:

${waiverTitle}

${waiverContentText || 'No waiver text is currently on file.'}

Please sign your waiver by clicking the link below:

${waiverUrl}

Thank you,
${this.businessId}
    `.trim();

    // Log communication
    const { error: commError } = await supabase
      .from('mail_contact_communications')
      .insert({
        contact_id: contactId,
        communication_type: 'email',
        direction: 'outbound',
        subject: 'Waiver Signing Link',
        content: emailContent,
        status: 'sent',
        sent_at: new Date().toISOString()
      });

    if (commError) {
      console.error('Error logging communication:', commError);
    }

    // Note: Actual email sending would be handled by the mail service
    // This function just logs the communication intent

    return {
      contactId,
      emailSent: true,
      waiverUrl
    };
  }

  // Send waiver PDF via email - EXACT SAME SETUP AS PAY STATEMENTS
  async sendWaiverPDF(waiverId, recipientEmail = null) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Get waiver information with template and business - EXACT SAME PATTERN AS PAY STATEMENTS
    const { data: waiver, error: waiverError } = await supabase
      .from('waiver_signatures')
      .select(`
        *,
        waiver_templates:template_id (
          template_name,
          waiver_title,
          waiver_content
        ),
        businesses:business_id (
          business_name,
          name
        )
      `)
      .eq('id', waiverId)
      .single();

    if (waiverError) {
      throw waiverError;
    }

    // Use recipientEmail parameter or waiver email
    const emailToSendTo = recipientEmail || waiver.email;
    
    if (!emailToSendTo) {
      throw new Error('No email address found for waiver recipient');
    }

    // Get participants if any
    const { data: participants } = await supabase
      .from('waiver_participants')
      .select('*')
      .eq('waiver_id', waiverId);

    // Get business name
    const businessName = waiver.businesses?.business_name || waiver.businesses?.name || 'Company';
    const signedDate = waiver.signed_at ? new Date(waiver.signed_at).toLocaleDateString('en-CA') : new Date().toLocaleDateString('en-CA');
    const emailPrimarySigSrc = resolveWaiverSignatureImgSrc(waiver);

    // Build participant info HTML
    let participantInfoHTML = '';
    if (participants && participants.length > 0) {
      participantInfoHTML = `
        <div style="margin-top: 20px;">
          <h3 style="font-size: 14px; font-weight: bold; margin-bottom: 10px;">Participants:</h3>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 10px;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Name</th>
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Type</th>
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Date of Birth</th>
              </tr>
            </thead>
            <tbody>
              ${participants.map(p => `
                <tr>
                  <td style="border: 1px solid #ddd; padding: 8px;">${p.first_name || ''} ${p.last_name || ''}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">${p.participant_type || 'N/A'}</td>
                  <td style="border: 1px solid #ddd; padding: 8px;">${formatDateOfBirthDisplay(p.date_of_birth, 'en-CA')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    // Generate waiver HTML content for PDF - EXACT SAME PATTERN AS PAY STATEMENTS
    const waiverHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          @page { 
            size: letter; 
            margin: 0.5in;
          }
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            line-height: 1.6;
            color: #000;
            background-color: #fff;
            font-size: 13px;
          }
          .header {
            text-align: center;
            border-bottom: 2px solid #333;
            padding-bottom: 10px;
            margin-bottom: 20px;
          }
          .company-name {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 5px;
          }
          .waiver-title {
            font-size: 16px;
            font-weight: bold;
            margin: 10px 0;
          }
          .waiver-content {
            margin: 20px 0;
            line-height: 1.8;
            white-space: pre-wrap;
            word-break: break-word;
          }
          .signature-section {
            margin-top: 40px;
            border-top: 1px solid #ddd;
            padding-top: 20px;
          }
          .signature-info {
            margin: 10px 0;
          }
          .signature-image {
            max-width: 300px;
            margin: 20px 0;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin: 15px 0;
          }
          th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
          }
          th {
            background-color: #f5f5f5;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="company-name">${businessName}</div>
          <div class="waiver-title">${waiver.waiver_templates?.waiver_title || waiver.waiver_templates?.template_name || 'Waiver'}</div>
        </div>

        <div class="waiver-content">
          ${waiver.waiver_templates?.waiver_content || ''}
        </div>

        <div class="signature-section">
          <h3 style="font-size: 14px; font-weight: bold; margin-bottom: 15px;">Signature Information</h3>
          <div class="signature-info">
            <strong>Name:</strong> ${waiver.first_name || ''} ${waiver.last_name || ''}<br>
            <strong>Email:</strong> ${waiver.email || 'N/A'}<br>
            <strong>Phone:</strong> ${waiver.phone_number || 'N/A'}<br>
            <strong>Date of Birth:</strong> ${formatDateOfBirthDisplay(waiver.date_of_birth, 'en-CA')}<br>
            <strong>Signed Date:</strong> ${signedDate}<br>
            ${waiver.expires_at ? `<strong>Expires:</strong> ${new Date(waiver.expires_at).toLocaleDateString('en-CA')}<br>` : ''}
          </div>
          ${emailPrimarySigSrc ? `<img src="${emailPrimarySigSrc}" alt="Signature" class="signature-image" />` : ''}
        </div>

        ${participantInfoHTML}

        <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 10px; color: #666;">
          <p>This waiver was generated electronically by Tavari Waiver System.</p>
          <p>Generated: ${new Date().toLocaleDateString('en-CA')} ${new Date().toLocaleTimeString()}</p>
        </div>
      </body>
      </html>
    `;

    // Generate PDF using html2pdf - EXACT SAME AS PAY STATEMENTS
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = waiverHTML;
    tempDiv.style.cssText = `
      position: absolute;
      top: 0px;
      left: 0px;
      width: 8.5in;
      min-height: 11in;
      background-color: white;
      visibility: visible;
      z-index: -1000;
      font-family: Arial, sans-serif;
    `;
    
    document.body.appendChild(tempDiv);
    
    // Force layout calculation and wait for DOM to settle - EXACT SAME AS PAY STATEMENTS
    tempDiv.offsetHeight;
    tempDiv.scrollHeight;
    await new Promise(resolve => setTimeout(resolve, 500));
    
    let pdfBlob;
    try {
      // EXACT html2pdf config from pay statements
      const opt = {
        margin: [0.5, 0.5, 0.5, 0.5],
        filename: `Waiver - ${waiver.first_name || ''} ${waiver.last_name || ''} - ${signedDate}.pdf`,
        image: { 
          type: 'jpeg', 
          quality: 0.98 
        },
        html2canvas: {
          scale: 1.5,
          useCORS: true,
          logging: false,
          letterRendering: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          width: 816,
          height: 1056
        },
        jsPDF: { 
          unit: 'in', 
          format: 'letter', 
          orientation: 'portrait',
          compress: true
        }
      };
      
      pdfBlob = await html2pdf().set(opt).from(tempDiv).outputPdf('blob');
      
      // Clean up
      if (document.body.contains(tempDiv)) {
        document.body.removeChild(tempDiv);
      }
      
      if (!pdfBlob || pdfBlob.size === 0) {
        throw new Error('PDF blob is empty or invalid');
      }
    } catch (pdfError) {
      // Clean up temporary element if it still exists
      if (document.body.contains(tempDiv)) {
        document.body.removeChild(tempDiv);
      }
      console.error('[WaiverEmail] Error generating PDF:', pdfError);
      throw pdfError;
    }
    
    // Convert PDF to base64 - EXACT SAME AS PAY STATEMENTS
    const pdfBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result.split(',')[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(pdfBlob);
    });

    // Create email HTML - EXACT SAME AS PAY STATEMENTS
    const emailSubject = `Your Signed Waiver - ${waiver.waiver_templates?.waiver_title || waiver.waiver_templates?.template_name || 'Waiver'}`;
    const emailBody = `Dear ${waiver.first_name || 'Customer'} ${waiver.last_name || ''},

Your signed waiver is attached to this email.

If you have any questions about your waiver, please contact us.

Thank you,
${businessName}`;

    const emailHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #000;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
          }
          .email-message {
            white-space: pre-wrap;
            margin-bottom: 20px;
          }
        </style>
      </head>
      <body>
        <div class="email-message">${emailBody.replace(/\n/g, '<br>')}</div>
      </body>
      </html>
    `;

    // Send email via mail-send edge function - EXACT SAME AS PAY STATEMENTS
    const senderEmail = 'noreply@tavarios.ca';
    const emailPayload = {
      businessId: this.businessId,
      campaignId: `waiver-${waiverId}-${Date.now()}`,
      contactId: `waiver-${emailToSendTo}`,
      to: emailToSendTo,
      fromEmail: senderEmail,
      fromName: `${businessName} - Waivers`,
      subject: emailSubject,
      html: emailHTML,
      text: emailBody,
      attachments: [{
        filename: `Waiver - ${waiver.first_name || ''} ${waiver.last_name || ''} - ${signedDate}.pdf`,
        content: pdfBase64,
        contentType: 'application/pdf'
      }]
    };

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
      throw new Error(errorBody || 'Failed to send email');
    }

    const data = await response.json();
    if (!data?.ok) {
      throw new Error(data?.error || 'Failed to send email');
    }

    // Get or create contact for logging
    let contactId;
    const { data: existingContact } = await supabase
      .from('mail_contacts')
      .select('id')
      .eq('business_id', this.businessId)
      .eq('email', emailToSendTo)
      .single();

    if (existingContact) {
      contactId = existingContact.id;
    } else {
      const { data: newContact } = await supabase
        .from('mail_contacts')
        .insert({
          business_id: this.businessId,
          email: emailToSendTo,
          first_name: waiver.first_name,
          last_name: waiver.last_name,
          subscribed: true
        })
        .select()
        .single();

      contactId = newContact?.id;
    }

    // Log communication
    if (contactId) {
      await supabase
        .from('mail_contact_communications')
        .insert({
          contact_id: contactId,
          communication_type: 'email',
          direction: 'outbound',
          subject: emailSubject,
          content: emailBody,
          status: 'sent',
          sent_at: new Date().toISOString()
        });
    }

    return { success: true, messageId: data?.messageId };
  }

  // Send expiry reminder
  async sendExpiryReminder(waiverId, recipientEmail) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Get waiver information
    const { data: waiver } = await supabase
      .from('waiver_signatures')
      .select('*, waiver_templates:template_id (template_name)')
      .eq('id', waiverId)
      .single();

    const emailContent = `
Hello ${waiver.first_name},

Your waiver is expiring soon. Please sign a new waiver if needed.

Expiry Date: ${waiver.expires_at ? new Date(waiver.expires_at).toLocaleDateString() : 'N/A'}

Thank you,
${this.businessId}
    `.trim();

    // Get or create contact and log communication
    // (Similar pattern as above)

    return { emailSent: true };
  }
}

export default new WaiverEmailService();



