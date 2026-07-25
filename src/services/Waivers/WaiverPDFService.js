// src/services/Waivers/WaiverPDFService.js
// PDF Generation Service for Waivers
// Generates full waiver PDF with signatures, participant info, and location data

import html2pdf from 'html2pdf.js';
import { supabase } from '../../supabaseClient';
import { formatDateOfBirthDisplay } from '../../utils/waiverDateOfBirth';
import { ADDITIONAL_ADULT_EMAIL_BANNER_HTML } from '../../constants/waiverLegalCopy';
import {
  formatSigningSourceLabel,
  waiverTemplateBodyInnerHtml,
  describeWaiverSigningDeviceText,
  formatUserAgentSummary
} from './waiverRecordDocumentHtml';
import { waiverConsentTypeLabel } from '../../constants/waiverConsentTypes';
import { resolveWaiverSignatureImgSrc } from '../../utils/waiverSignatureDisplay';

class WaiverPDFService {
  /**
   * Generate PDF for a signed waiver
   * @param {string} waiverId - Waiver signature ID
   * @param {object} options - PDF generation options
   * @returns {Promise<{blob: Blob, base64: string, filename: string}>}
   */
  async generateWaiverPDF(waiverId, options = {}) {
    try {
      // Load waiver data
      const { data: waiver, error } = await supabase
        .from('waiver_signatures')
        .select(`
          *,
          waiver_templates:template_id (
            id,
            template_name,
            waiver_title,
            waiver_content,
            fields_config
          ),
          waiver_participants (*),
          waiver_consents (*),
          waiver_field_responses (
            *,
            waiver_fields:field_id (*)
          )
        `)
        .eq('id', waiverId)
        .single();

      if (error) throw error;
      if (!waiver) throw new Error('Waiver not found');

      // Generate HTML content
      const htmlContent = this.generateWaiverHTML(waiver);

      // Generate PDF
      const pdfBlob = await this.htmlToPDF(htmlContent, {
        filename: this.generateFilename(waiver),
        ...options
      });

      // Convert to base64 for email
      const base64 = await this.blobToBase64(pdfBlob);

      return {
        blob: pdfBlob,
        base64: base64,
        filename: this.generateFilename(waiver)
      };
    } catch (error) {
      console.error('[WaiverPDFService] Error generating PDF:', error);
      throw error;
    }
  }

  /**
   * CSS for waiver document markup, scoped to a root id (avoids leaking into the app).
   * @param {string} rootSelector e.g. '#waiver-inline-root' or '#waiver-pdf-root'
   * @param {{ compactPadding?: boolean }} opts
   */
  getScopedWaiverStyles(rootSelector, opts = {}) {
    const compact = !!opts.compactPadding;
    const pad = compact ? '16px' : '1in';
    const baseSize = compact ? '15px' : '11pt';
    const titleSize = compact ? '1.35rem' : '18pt';
    const subHeaderSize = compact ? '0.8rem' : '10pt';
    const partHeaderSize = compact ? '1.05rem' : '12pt';
    const footerSize = compact ? '12px' : '9pt';

    return `
${rootSelector} {
  font-family: Arial, Helvetica, sans-serif;
  font-size: ${baseSize};
  line-height: 1.6;
  color: #111;
  padding: ${pad};
  margin: 0;
  box-sizing: border-box;
  text-align: left;
}
${rootSelector} .header {
  margin-bottom: 2rem;
  border-bottom: 2px solid #000;
  padding-bottom: 1rem;
}
${rootSelector} .title {
  font-size: ${titleSize};
  font-weight: bold;
  margin-bottom: 0.5rem;
}
${rootSelector} .waiver-content {
  margin: 2rem 0;
  white-space: break-spaces;
  word-break: break-word;
}
${rootSelector} .waiver-legal-body,
${rootSelector} .waiver-legal-body-preserve {
  white-space: break-spaces;
  word-break: break-word;
}
${rootSelector} .participant-section {
  margin: 2rem 0;
  border-top: 1px solid #ccc;
  padding-top: 1rem;
}
${rootSelector} .participant-header {
  font-weight: bold;
  font-size: ${partHeaderSize};
  margin-bottom: 0.5rem;
}
${rootSelector} .participant-info {
  margin: 0.5rem 0;
}
${rootSelector} .signature-section {
  margin: 2rem 0;
  border-top: 1px solid #ccc;
  padding-top: 1rem;
}
${rootSelector} .signature-image {
  max-width: 100%;
  max-height: ${compact ? '200px' : '150px'};
  border: 1px solid #ccc;
  margin: 1rem 0;
  object-fit: contain;
}
${rootSelector} .footer {
  margin-top: 3rem;
  border-top: 1px solid #ccc;
  padding-top: 1rem;
  font-size: ${footerSize};
  color: #666;
}
${rootSelector} .info-grid {
  display: table;
  width: 100%;
  margin: 1rem 0;
}
${rootSelector} .info-row {
  display: table-row;
}
${rootSelector} .info-label {
  display: table-cell;
  font-weight: bold;
  padding-right: 1rem;
  width: 150px;
  vertical-align: top;
}
${rootSelector} .info-value {
  display: table-cell;
  word-break: break-word;
}
${rootSelector} .consent-list {
  margin: 1rem 0;
}
${rootSelector} .consent-item {
  margin: 0.5rem 0;
}
${rootSelector} .waiver-meta {
  font-size: ${subHeaderSize};
  color: #666;
}
`.trim();
  }

  /**
   * Inner body markup shared by PDF HTML and in-app inline preview (no html/body wrapper).
   * @param {object} waiver — expects waiver_templates, waiver_participants, waiver_consents when available
   */
  buildWaiverBodyInnerHTML(waiver) {
    const template = waiver.waiver_templates;
    if (!template) {
      return '<div class="footer"><p>Template not available for this waiver.</p></div>';
    }

    const participants = waiver.waiver_participants || [];
    const consents = waiver.waiver_consents || [];

    const signedDate = waiver.signed_at
      ? new Date(waiver.signed_at).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      : 'Not recorded';

    const expiryDate = waiver.expires_at
      ? new Date(waiver.expires_at).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
      : 'No expiry';

    let whereSignedLine = 'Not recorded';
    if (waiver.location_source) {
      whereSignedLine = formatSigningSourceLabel(waiver.location_source);
      if (waiver.location_address) {
        whereSignedLine += ` — ${waiver.location_address}`;
      }
    } else if (waiver.location_address) {
      whereSignedLine = `${waiver.location_address}${waiver.location_city ? ', ' + waiver.location_city : ''}${waiver.location_state ? ', ' + waiver.location_state : ''}`;
    }

    const hasAdditionalAdults = participants.some(
      (p) => String(p.participant_type || '').toLowerCase() === 'additional_adult'
    );
    const additionalBanner = hasAdditionalAdults ? ADDITIONAL_ADULT_EMAIL_BANNER_HTML : '';

    const waiverRowSigSrc = resolveWaiverSignatureImgSrc(waiver);

    const acks = waiver.additional_adult_intent_acknowledgments;
    let intentAckBlock = '';
    if (Array.isArray(acks) && acks.length > 0) {
      intentAckBlock = `
  <div class="participant-section" style="border:2px solid #1e3a5f;background:#f0f7ff;padding:12px;">
    <div class="participant-header">Additional adult — pre-registration confirmations</div>
    <p style="font-size:10pt;margin:0 0 8px 0;">Recorded when the primary signer chose to add another adult (legal record).</p>
    ${acks
      .map(
        (a, i) => `
    <div style="margin-top:10px;padding:8px;background:#fff;border:1px solid #cbd5e1;font-size:9pt;">
      <strong>#${i + 1}</strong> ${this.escapeHtml(a.acknowledged_at || '')}<br/>
      ${a.ip_address ? `IP: ${this.escapeHtml(String(a.ip_address))}<br/>` : ''}
      ${a.user_agent ? `Device (summary): ${this.escapeHtml(formatUserAgentSummary(a.user_agent) || '—')}<br/>` : ''}
      <span style="font-style:italic;">${this.escapeHtml(a.acknowledgment_text || '')}</span>
    </div>`
      )
      .join('')}
  </div>`;
    }

    return `
  <div class="header">
    <div class="title">${this.escapeHtml(template.waiver_title || 'Waiver')}</div>
    <div class="waiver-meta">
      Signed: ${this.escapeHtml(signedDate)}<br>
      Expires: ${this.escapeHtml(expiryDate)}<br>
      Signing environment: ${this.escapeHtml(whereSignedLine)}
    </div>
  </div>

  ${additionalBanner}

  <div class="waiver-content">
${waiverTemplateBodyInnerHtml(template.waiver_content || '')}
  </div>

  <div class="participant-section" style="background:#ecfdf5;border:1px solid #6ee7b7;padding:12px;margin:1rem 0;">
    <div class="participant-header">Acknowledgment of waiver content</div>
    <p style="margin:0;font-size:11pt;line-height:1.45;">
      <strong>&#9745; Confirmed:</strong> The signatory completed the on-screen review of this waiver and agreed to its terms before signing (electronically recorded).
    </p>
  </div>

  ${!participants.some((p) => String(p.participant_type || '').toLowerCase() === 'primary') && waiverRowSigSrc ? `
  <div class="signature-section">
    <div class="participant-header">Signer signature (record)</div>
    <img src="${waiverRowSigSrc}" class="signature-image" alt="Signature" />
  </div>` : ''}

  ${participants.map((p, idx) => this.generateParticipantHTML(p, idx)).join('')}

  ${consents.length > 0 ? this.generateConsentsHTML(consents) : ''}

  ${intentAckBlock}

  <div class="footer">
    <p><strong>Waiver ID:</strong> ${this.escapeHtml(String(waiver.id || ''))}</p>
    <p><strong>Signed At:</strong> ${this.escapeHtml(signedDate)}</p>
    ${waiver.ip_address ? `<p><strong>IP (submission):</strong> ${this.escapeHtml(String(waiver.ip_address))}</p>` : ''}
    ${(() => {
      const deviceText = describeWaiverSigningDeviceText(waiver);
      return deviceText
        ? `<p><strong>Signing device / how:</strong> ${this.escapeHtml(deviceText)}</p>`
        : '';
    })()}
    ${waiver.signature_token ? `<p><strong>Signature Token:</strong> ${this.escapeHtml(String(waiver.signature_token))}</p>` : ''}
  </div>`;
  }

  /**
   * Markup + scoped styles for in-app modal (no PDF; stays in the SPA).
   * @param {object} waiver
   * @returns {string}
   */
  getWaiverInlinePreviewMarkup(waiver) {
    const inner = this.buildWaiverBodyInnerHTML(waiver);
    const styles = this.getScopedWaiverStyles('#waiver-inline-root', { compactPadding: true });
    return `<style type="text/css">${styles}</style><div id="waiver-inline-root">${inner}</div>`;
  }

  /**
   * Generate HTML content for waiver PDF
   * @param {object} waiver - Waiver data with template and participants
   * @returns {string} HTML content
   */
  generateWaiverHTML(waiver) {
    const inner = this.buildWaiverBodyInnerHTML(waiver);
    const styles = this.getScopedWaiverStyles('#waiver-pdf-root', { compactPadding: false });
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>${styles}</style>
</head>
<body style="margin:0;padding:0;">
  <div id="waiver-pdf-root">${inner}</div>
</body>
</html>`;
  }

  generateParticipantHTML(participant, index) {
    const isPrimary = participant.participant_type === 'primary';
    const isMinor = participant.participant_type === 'minor';
    const isAdditionalAdult = participant.participant_type === 'additional_adult';

    let participantTypeLabel = 'Participant';
    if (isPrimary) participantTypeLabel = 'Primary Adult';
    else if (isAdditionalAdult) participantTypeLabel = 'Additional Adult';
    else if (isMinor) participantTypeLabel = 'Minor';

    const signedDate = participant.signed_at
      ? new Date(participant.signed_at).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      : 'Not signed';

    const participantSigSrc = resolveWaiverSignatureImgSrc(participant);

    return `
  <div class="participant-section">
    <div class="participant-header">${participantTypeLabel} ${index + 1}</div>
    <div class="info-grid">
      <div class="info-row">
        <div class="info-label">Name:</div>
        <div class="info-value">${participant.first_name || ''} ${participant.last_name || ''}</div>
      </div>
      ${participant.date_of_birth ? `
      <div class="info-row">
        <div class="info-label">Date of Birth:</div>
        <div class="info-value">${formatDateOfBirthDisplay(participant.date_of_birth, 'en-US')}</div>
      </div>` : ''}
      ${participant.email ? `
      <div class="info-row">
        <div class="info-label">Email:</div>
        <div class="info-value">${participant.email}</div>
      </div>` : ''}
      ${participant.phone_number ? `
      <div class="info-row">
        <div class="info-label">Phone:</div>
        <div class="info-value">${participant.phone_number}</div>
      </div>` : ''}
      ${participant.address ? `
      <div class="info-row">
        <div class="info-label">Address:</div>
        <div class="info-value">${this.escapeHtml(String(participant.address))}</div>
      </div>` : ''}
      ${participant.city ? `
      <div class="info-row">
        <div class="info-label">City:</div>
        <div class="info-value">${this.escapeHtml(String(participant.city))}</div>
      </div>` : ''}
      ${participant.postal_code ? `
      <div class="info-row">
        <div class="info-label">Postal code:</div>
        <div class="info-value">${this.escapeHtml(String(participant.postal_code))}</div>
      </div>` : ''}
      ${participant.relationship_to_minor ? `
      <div class="info-row">
        <div class="info-label">Relationship:</div>
        <div class="info-value">${participant.relationship_to_minor}</div>
      </div>` : ''}
    </div>
    ${participantSigSrc ? `
    <div class="signature-section">
      <div class="participant-header">Signature</div>
      <img src="${participantSigSrc}" class="signature-image" alt="Signature" />
      <div style="margin-top: 0.5rem; font-size: 10pt;">Signed: ${signedDate}</div>
    </div>` : ''}
  </div>`;
  }

  generateConsentsHTML(consents) {
    return `
  <div class="participant-section">
    <div class="participant-header">Consents</div>
    <div class="consent-list">
      ${consents.map(c => `
      <div class="consent-item">
        <strong>${this.escapeHtml(waiverConsentTypeLabel(c.consent_type))}:</strong> ${c.consent_given ? 'Yes' : 'No'}
        ${c.consent_text ? ` - ${this.escapeHtml(c.consent_text)}` : ''}
      </div>
      `).join('')}
    </div>
  </div>`;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Convert HTML to PDF blob
   * @param {string} html - HTML content
   * @param {object} options - PDF options
   * @returns {Promise<Blob>}
   */
  async htmlToPDF(html, options = {}) {
    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'absolute';
    tempDiv.style.left = '-9999px';
    tempDiv.style.top = '-9999px';
    tempDiv.style.width = '8.5in';
    tempDiv.style.backgroundColor = 'white';
    tempDiv.innerHTML = html;
    document.body.appendChild(tempDiv);

    await new Promise(resolve => setTimeout(resolve, 100));

    const pdfOptions = {
      margin: [0.5, 0.5, 0.5, 0.5],
      filename: options.filename || 'waiver.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        letterRendering: true,
        allowTaint: true
      },
      jsPDF: {
        unit: 'in',
        format: 'letter',
        orientation: 'portrait'
      },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    const pdfBlob = await html2pdf().set(pdfOptions).from(tempDiv).outputPdf('blob');
    document.body.removeChild(tempDiv);

    return pdfBlob;
  }

  /**
   * Convert blob to base64
   * @param {Blob} blob
   * @returns {Promise<string>}
   */
  async blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result.split(',')[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Generate filename for waiver PDF
   * @param {object} waiver
   * @returns {string}
   */
  generateFilename(waiver) {
    const firstName = waiver.first_name || 'Unknown';
    const lastName = waiver.last_name || 'Customer';
    const date = new Date(waiver.signed_at).toISOString().split('T')[0];
    return `Waiver_${firstName}_${lastName}_${date}.pdf`;
  }

  /**
   * Upload PDF to storage
   * @param {string} waiverId
   * @param {Blob} pdfBlob
   * @returns {Promise<string>} Public URL
   */
  async uploadPDFToStorage(waiverId, pdfBlob) {
    try {
      const filename = `waiver_${waiverId}_${Date.now()}.pdf`;
      const filePath = `waivers/${waiverId}/${filename}`;

      const { data, error } = await supabase.storage
        .from('waivers')
        .upload(filePath, pdfBlob, {
          contentType: 'application/pdf',
          upsert: true
        });

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('waivers')
        .getPublicUrl(filePath);

      return publicUrl;
    } catch (error) {
      console.error('[WaiverPDFService] Error uploading PDF:', error);
      throw error;
    }
  }
}

export const waiverPDFService = new WaiverPDFService();
export default waiverPDFService;





