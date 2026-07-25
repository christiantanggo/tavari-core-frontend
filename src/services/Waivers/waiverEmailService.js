// Step 67: Create waiverEmailService.js
// Service for sending waiver-related emails
// Uses existing mail_contacts, mail_campaign_sends, mail_contact_communications tables
// EXACT SAME SETUP AS PAY STATEMENTS
import { supabase } from '../../supabaseClient';
import html2pdf from 'html2pdf.js';
import { buildWaiverRecordDocumentHtml, waiverTemplateBodyInnerHtml } from './waiverRecordDocumentHtml';
import WaiverMailIntegration from './WaiverMailIntegration';

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

    const { data: businessData } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', this.businessId)
      .single();

    const { data: mailSettings } = await supabase
      .from('mail_settings')
      .select('from_name')
      .eq('business_id', this.businessId)
      .single();

    const businessName = businessData?.name || 'Tavari';
    const fromName = mailSettings?.from_name || `${businessName} - Waivers`;

    WaiverMailIntegration.setBusinessId(this.businessId);
    const syncResult = await WaiverMailIntegration.syncWaiverToMail(waiverId, recipientEmail);
    const contactId = syncResult?.contact_id || null;

    // Generate waiver URL
    const waiverUrl = `${window.location.origin}/waivers/sign/${waiver.signature_token}`;
    const waiverTitle = waiver.waiver_templates?.waiver_title || waiver.waiver_templates?.template_name || 'Waiver';
    const waiverContentHtml = waiverTemplateBodyInnerHtml(waiver.waiver_templates?.waiver_content || '');
    const waiverContentText = stripHtmlToText(waiver.waiver_templates?.waiver_content || '');

    // Create email content
    const emailContent = `
Hello ${waiver.first_name},

Please review the waiver below before signing:

${waiverTitle}

${waiverContentText || 'No waiver text is currently on file.'}

Please sign your ${waiverTitle} by clicking the link below:

${waiverUrl}

Thank you,
${businessName}
    `.trim();

    const emailHTML = `
      <div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #111827;">
        <p>Hello ${waiver.first_name || 'there'},</p>
        <p>Please review the waiver below before signing:</p>
        <div style="margin: 20px 0; padding: 16px; border: 1px solid #d1d5db; border-radius: 8px; background: #f9fafb;">
          <h2 style="margin: 0 0 12px; font-size: 18px;">${waiverTitle}</h2>
          ${waiverContentHtml}
        </div>
        <p>Please sign your <strong>${waiverTitle}</strong> by clicking the link below:</p>
        <p>
          <a href="${waiverUrl}" style="color: #0f766e; font-weight: bold;">
            Review and Sign Waiver
          </a>
        </p>
        <p>If the button does not work, copy and paste this link into your browser:</p>
        <p style="word-break: break-all;">${waiverUrl}</p>
        <p>Thank you,<br />${businessName}</p>
      </div>
    `.trim();

    const emailPayload = {
      businessId: this.businessId,
      campaignId: `waiver-link-${waiverId}-${Date.now()}`,
      contactId: contactId || null,
      emailType: 'transactional',
      to: recipientEmail,
      fromEmail: 'noreply@tavarios.ca',
      fromName,
      subject: `${businessName} Waiver Link`,
      html: emailHTML,
      text: emailContent
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
      throw new Error(errorBody || 'Failed to send waiver link email');
    }

    const data = await response.json();
    if (!data?.ok) {
      throw new Error(data?.error || 'Failed to send waiver link email');
    }

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

    return {
      contactId,
      emailSent: true,
      waiverUrl,
      messageId: data?.messageId || null
    };
  }

  /**
   * Load waiver + participants, build legal HTML, render PDF blob (same artifact as email attachment / storage).
   */
  async buildSignedWaiverPdfPackage(waiverId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

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
          name
        )
      `)
      .eq('id', waiverId)
      .single();

    if (waiverError) {
      throw waiverError;
    }

    const { data: participants } = await supabase
      .from('waiver_participants')
      .select('*')
      .eq('waiver_id', waiverId);

    const { data: consents } = await supabase
      .from('waiver_consents')
      .select('consent_type, consent_given, consent_text, acknowledged_at')
      .eq('waiver_id', waiverId)
      .order('acknowledged_at', { ascending: true });

    let businessName = waiver.businesses?.name;

    if (!businessName) {
      const { data: businessData } = await supabase
        .from('businesses')
        .select('name')
        .eq('id', this.businessId)
        .single();

      businessName = businessData?.name;
    }

    if (!businessName) {
      businessName = 'Tavari';
    }

    let fromName = null;
    const { data: mailSettings } = await supabase
      .from('mail_settings')
      .select('from_name')
      .eq('business_id', this.businessId)
      .single();

    if (mailSettings?.from_name) {
      fromName = mailSettings.from_name;
    } else {
      fromName = `${businessName} - Waivers`;
    }

    const signedDate = waiver.signed_at
      ? new Date(waiver.signed_at).toLocaleDateString('en-CA')
      : new Date().toLocaleDateString('en-CA');

    const waiverHTML = buildWaiverRecordDocumentHtml(
      { ...waiver, waiver_consents: consents || [] },
      participants || [],
      businessName,
      {
      includeIntentAckDetail: true
      }
    );

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

    tempDiv.offsetHeight;
    tempDiv.scrollHeight;
    await new Promise((resolve) => setTimeout(resolve, 500));

    let pdfBlob;
    try {
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

      if (document.body.contains(tempDiv)) {
        document.body.removeChild(tempDiv);
      }

      if (!pdfBlob || pdfBlob.size === 0) {
        throw new Error('PDF blob is empty or invalid');
      }
    } catch (pdfError) {
      if (document.body.contains(tempDiv)) {
        document.body.removeChild(tempDiv);
      }
      console.error('[WaiverEmail] Error generating PDF:', pdfError);
      throw pdfError;
    }

    const pdfBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result.split(',')[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(pdfBlob);
    });

    return {
      waiver,
      participants: participants || [],
      businessName,
      fromName,
      signedDate,
      waiverHTML,
      pdfBlob,
      pdfBase64
    };
  }

  /**
   * @param {string} waiverId
   * @param {string|null} recipientEmail
   * @param {{ pdfPackage?: object }} [options] — reuse PDF from finalizeSignedWaiverPdfArchival to avoid double generation
   */
  async sendWaiverPDF(waiverId, recipientEmail = null, options = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const pkg = options.pdfPackage || (await this.buildSignedWaiverPdfPackage(waiverId));
    const { waiver, businessName, fromName, signedDate, waiverHTML, pdfBase64 } = pkg;

    const emailToSendTo = recipientEmail || waiver.email;

    if (!emailToSendTo) {
      throw new Error('No email address found for waiver recipient');
    }

    WaiverMailIntegration.setBusinessId(this.businessId);
    const syncResult = await WaiverMailIntegration.syncWaiverToMail(waiverId, emailToSendTo);
    const contactId = syncResult?.contact_id || null;

    // Create email HTML - EXACT SAME AS PAY STATEMENTS
    const waiverTitle = waiver.waiver_templates?.waiver_title || waiver.waiver_templates?.template_name || 'Waiver';
    const emailSubject = `Your Signed Waiver - ${waiverTitle}`;
    const emailIntro = `<div style="font-family:Arial,sans-serif;font-size: 14px;line-height:1.5;margin:0 0 20px 0;padding:12px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe;">
<p style="margin:0 0 12px 0;">Dear ${waiver.first_name || 'Customer'} ${waiver.last_name || ''},</p>
<p style="margin:0 0 12px 0;">Below is your <strong>complete signed waiver record</strong> (full terms, electronic acknowledgment, signatures, how/where it was signed, and any additional-adult notices). A <strong>PDF copy</strong> is attached.</p>
<p style="margin:0;">Questions? Contact <strong>${businessName}</strong>.</p>
</div>`;

    const emailHTML = waiverHTML.replace(/<body([^>]*)>/i, `<body$1>${emailIntro}`);

    const emailBody = `Dear ${waiver.first_name || 'Customer'} ${waiver.last_name || ''},

Your signed waiver (${waiverTitle}) is in this email as HTML and attached as PDF. It includes the full waiver text, electronic acknowledgment, signatures, and where/how it was signed.

Thank you,
${businessName}`;

    // Send email via mail-send edge function - EXACT SAME AS PAY STATEMENTS
    const senderEmail = 'noreply@tavarios.ca';
    const emailPayload = {
      businessId: this.businessId,
      campaignId: `waiver-${waiverId}-${Date.now()}`,
      contactId: contactId || null,
      emailType: 'transactional',
      to: emailToSendTo,
      fromEmail: senderEmail,
      fromName: fromName, // Use fromName from mail settings or business name fallback
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
