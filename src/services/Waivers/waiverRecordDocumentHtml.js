/**
 * Single HTML document for waiver email body + PDF generation (court-ready record).
 */
import { formatDateOfBirthDisplay } from '../../utils/waiverDateOfBirth';
import { resolveWaiverSignatureImgSrc } from '../../utils/waiverSignatureDisplay';
import {
  ADDITIONAL_ADULT_EMAIL_BANNER_HTML,
  ADDITIONAL_ADULT_INTENT_DISCLAIMER_VERSION
} from '../../constants/waiverLegalCopy';

function escapeHtml(text) {
  if (text == null || text === '') return '';
  const div = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (div) {
    div.textContent = String(text);
    return div.innerHTML;
  }
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripScripts(html) {
  if (!html || typeof html !== 'string') return '';
  return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
}

function plainTextToPreservedHtml(text) {
  return escapeHtml(text)
    .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;')
    .replace(/ {2,}/g, (spaces) => '&nbsp;'.repeat(spaces.length))
    .replace(/\r\n|\r|\n/g, '<br />');
}

export function formatSigningSourceLabel(source) {
  const s = String(source || '').toLowerCase();
  const map = {
    browser: 'Online — customer web browser (personal device)',
    browser_kiosk: 'On-site browser kiosk (shared signing station at the business)',
    kiosk: 'On-site waiver kiosk app (tablet / full-screen app)',
    mobile_app: 'Mobile app',
    in_person: 'In person (staff-assisted)',
    off_site: 'Off-site / remote',
    mobile_web: 'Mobile web browser'
  };
  return map[s] || (source ? String(source) : 'Not recorded');
}

/**
 * Short browser/OS line from a user-agent string (not the raw UA).
 */
export function formatUserAgentSummary(ua) {
  if (ua == null || ua === '') return '';
  const u = String(ua).toLowerCase();
  let browser = 'Web browser';
  if (u.includes('edg/')) browser = 'Microsoft Edge';
  else if (u.includes('opr/') || u.includes('opera')) browser = 'Opera';
  else if (u.includes('chrome') || u.includes('crios')) browser = 'Chrome';
  else if (u.includes('firefox') || u.includes('fxios')) browser = 'Firefox';
  else if (u.includes('safari') && !u.includes('chrome')) browser = 'Safari';

  let os = '';
  if (u.includes('windows')) os = 'Windows';
  else if (u.includes('mac os') || u.includes('macintosh')) os = 'macOS';
  else if (u.includes('android')) os = 'Android';
  else if (u.includes('iphone') || u.includes('ipad') || u.includes('ios')) os = 'iOS';
  else if (u.includes('linux')) os = 'Linux';

  return os ? `${browser} on ${os}` : browser;
}

/**
 * Human-readable signing context for PDFs and inline waiver view (replaces raw user-agent).
 */
export function describeWaiverSigningDeviceText(waiver) {
  const src = String(waiver?.location_source || '').toLowerCase();
  const envLabel = waiver?.location_source ? formatSigningSourceLabel(waiver.location_source) : '';
  const uaShort = formatUserAgentSummary(waiver?.user_agent);
  const showBrowserApp =
    uaShort &&
    (src === 'browser' ||
      src === 'browser_kiosk' ||
      src === 'mobile_web' ||
      src === 'kiosk' ||
      src === 'mobile_app');
  if (envLabel && showBrowserApp) {
    return `${envLabel} The software on that device reported: ${uaShort}.`;
  }
  if (envLabel) return `${envLabel}.`;
  if (uaShort) return `Signing software (summary): ${uaShort}.`;
  return '';
}

function waiverBodyHtml(rawContent) {
  const raw = rawContent || '';
  const trimmed = raw.trim();
  if (!trimmed) return '<p><em>No waiver text on file.</em></p>';
  if (/<\s*[a-z][\s\S]*>/i.test(trimmed)) {
    return `<div class="waiver-legal-body waiver-legal-body-preserve">${stripScripts(trimmed)}</div>`;
  }
  return `<div class="waiver-legal-body waiver-legal-body-preserve">${plainTextToPreservedHtml(trimmed)}</div>`;
}

function getSignatureImageSrc(signatureImageUrl, signatureData) {
  return resolveWaiverSignatureImgSrc({
    signature_image_url: signatureImageUrl,
    signature_data: signatureData
  });
}

function formatParticipantTypeLabel(type) {
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'additional_adult') return 'Additional Adult';
  if (normalized === 'minor') return 'Child';
  if (normalized === 'primary') return 'Primary Adult';
  return type ? String(type) : 'Participant';
}

function formatPortalAccessLabel(value) {
  const raw = String(value || '').toLowerCase();
  if (raw === 'co_primary') return 'Can view and manage this waiver';
  if (raw === 'full_view') return 'Can view everyone on this waiver';
  if (raw === 'self_only') return 'Can only view their own waiver details';
  return value ? String(value) : 'Not selected';
}

function buildConsentMap(consents) {
  const map = {};
  (Array.isArray(consents) ? consents : []).forEach((row) => {
    const key = String(row?.consent_type || '').trim();
    if (!key) return;
    map[key] = !!row?.consent_given;
  });
  return map;
}

function getConsentValue(consentMap, key, fallback = false) {
  return Object.prototype.hasOwnProperty.call(consentMap, key)
    ? !!consentMap[key]
    : fallback;
}

function buildParticipantBlock(title, rows, opts = {}) {
  const { includeSignature = false, consentMap = {}, additionalAdultAcks = [] } = opts;
  if (!rows.length) return '';
  return `
    <h2 style="font-size: 14px;margin:24px 0 10px 0;">${escapeHtml(title)}</h2>
    ${rows.map((row, index) => {
      const fullName = `${row.first_name || row.data?.firstName || ''} ${row.last_name || row.data?.lastName || ''}`.trim() || '—';
      const dob = formatDateOfBirthDisplay(row.date_of_birth || row.data?.dateOfBirth, 'en-CA');
      const signedAt = row.signed_at
        ? new Date(row.signed_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })
        : '—';
      const mailing = [row.address || row.data?.address, row.city || row.data?.city, row.postal_code || row.data?.postalCode]
        .filter((x) => x != null && String(x).trim() !== '')
        .join(', ') || '—';
      const signatureSrc = getSignatureImageSrc(row.signature_image_url, row.signature_data);
      const participantNameKey = String(fullName).trim().toLowerCase();
      const adultAck = additionalAdultAcks.find((ack) =>
        String(ack?.kind || '').toLowerCase() === 'adult_signer_ack' &&
        String(ack?.participant_name || '').trim().toLowerCase() === participantNameKey
      );
      return `
        <div style="margin-top:${index === 0 ? '0' : '16px'};padding:14px;border:1px solid #dbe4ee;border-radius:8px;background:#fff;">
          <div style="font-weight:bold;font-size: 13px;margin-bottom:8px;">${escapeHtml(fullName)}</div>
          <div style="font-size: 13px;line-height:1.6;">
            <div><strong>Date of birth:</strong> ${escapeHtml(dob)}</div>
            ${row.email || row.data?.email ? `<div><strong>Email:</strong> ${escapeHtml(row.email || row.data?.email)}</div>` : ''}
            ${row.phone_number || row.data?.phoneNumber ? `<div><strong>Phone:</strong> ${escapeHtml(row.phone_number || row.data?.phoneNumber)}</div>` : ''}
            <div><strong>Mailing address:</strong> ${escapeHtml(mailing)}</div>
            ${row.participant_portal_access ? `<div><strong>Portal access:</strong> ${escapeHtml(formatPortalAccessLabel(row.participant_portal_access))}</div>` : ''}
            ${includeSignature ? `<div><strong>Signed:</strong> ${escapeHtml(signedAt)}</div>` : ''}
          </div>
          ${includeSignature ? `
            <div style="margin-top:10px;">
              <div style="margin-bottom:6px;font-size: 13px;line-height:1.45;">${
                adultAck
                  ? (adultAck.waiver_terms_accepted ? '&#9745;' : '&#9744;') + ' I agree to the waiver'
                  : (consentMap.waiver_terms ? '&#9745;' : '&#9744;') + ' I agree to the waiver'
              }</div>
              <div style="margin-bottom:6px;font-size: 13px;line-height:1.45;">${
                adultAck
                  ? (adultAck.electronic_signature_accepted ? '&#9745;' : '&#9744;') + ' I agree to use an electronic signature'
                  : (consentMap.electronic_signature ? '&#9745;' : '&#9744;') + ' I agree to use an electronic signature'
              }</div>
              ${
                adultAck
                  ? `<div style="margin-bottom:6px;font-size: 13px;line-height:1.45;">${adultAck.signed_by_self_confirmed ? '&#9745;' : '&#9744;'} I confirm the additional adult personally reviewed and signed this waiver</div>`
                  : ''
              }
              ${
                adultAck && Object.prototype.hasOwnProperty.call(adultAck, 'marketing_accepted')
                  ? `<div style="margin-bottom:6px;font-size: 13px;line-height:1.45;">${adultAck.marketing_accepted ? '&#9745;' : '&#9744;'} I agree to marketing communications</div>`
                  : ''
              }
              ${signatureSrc
                ? `<img src="${escapeHtml(signatureSrc)}" alt="${escapeHtml(title)} signature" style="max-width:280px;max-height:120px;border:1px solid #ccc;" crossorigin="anonymous" />`
                : '<div style="color:#666;font-size: 11px;">No signature image on file.</div>'}
            </div>
          ` : ''}
        </div>
      `;
    }).join('')}
  `;
}

/** Template body only (for embedding in PDF/inline views that use their own wrapper). */
export function waiverTemplateBodyInnerHtml(rawContent) {
  return waiverBodyHtml(rawContent);
}

/**
 * @param {object} waiver - waiver_signatures row + waiver_templates join
 * @param {Array} participants - waiver_participants rows
 * @param {string} businessName
 * @param {object} opts
 * @param {boolean} [opts.includeIntentAckDetail] - full stored ack text blocks
 */
export function buildWaiverRecordDocumentHtml(waiver, participants, businessName, opts = {}) {
  const { includeIntentAckDetail = true } = opts;
  const tpl = waiver.waiver_templates || {};
  const title = escapeHtml(tpl.waiver_title || tpl.template_name || 'Waiver');
  const signedPrimary = waiver.signed_at
    ? new Date(waiver.signed_at).toLocaleString('en-CA', {
        dateStyle: 'medium',
        timeStyle: 'short'
      })
    : '—';

  const parts = Array.isArray(participants) ? participants : [];
  const minors = parts.filter((p) => String(p.participant_type || '').toLowerCase() === 'minor');
  const additionalAdults = parts.filter((p) => String(p.participant_type || '').toLowerCase() === 'additional_adult');
  const consentMap = buildConsentMap(waiver.waiver_consents);
  const primaryWaiverTermsAccepted = getConsentValue(consentMap, 'waiver_terms', !!waiver.signed_at);
  const primaryElectronicSignatureAccepted = getConsentValue(
    consentMap,
    'electronic_signature',
    !!waiver.signed_at
  );
  const primaryMarketingAccepted = getConsentValue(
    consentMap,
    'marketing',
    !!waiver.marketing_opt_in
  );
  const acks = Array.isArray(waiver.additional_adult_intent_acknowledgments)
    ? waiver.additional_adult_intent_acknowledgments
    : [];
  const disclaimerAck = acks.find((ack) => String(ack?.kind || '').toLowerCase() !== 'adult_signer_ack');
  const disclaimerText = disclaimerAck?.acknowledgment_text || '';
  const primarySigSrc = getSignatureImageSrc(waiver.signature_image_url, waiver.signature_data);
  const logoUrl = waiver?.businesses?.logo_url || waiver?.logo_url || waiver?.business_logo_url || '';
  const hasAdditionalAdults = additionalAdults.length > 0;

  const locParts = [];
  if (waiver.location_source) {
    locParts.push(`<strong>Signing method:</strong> ${escapeHtml(formatSigningSourceLabel(waiver.location_source))}`);
  }
  if (waiver.location_address) {
    locParts.push(`<strong>Approx. location (if captured):</strong> ${escapeHtml(waiver.location_address)}`);
  }
  if (waiver.location_city || waiver.location_state) {
    locParts.push(
      `${escapeHtml([waiver.location_city, waiver.location_state].filter(Boolean).join(', '))}`
    );
  }
  if (waiver.ip_address) {
    locParts.push(`<strong>IP address (at submission):</strong> ${escapeHtml(waiver.ip_address)}`);
  }
  if (waiver.user_agent) {
    locParts.push(
      `<strong>Device / browser (user agent):</strong> <span style="word-break:break-all;font-size: 10px;">${escapeHtml(waiver.user_agent)}</span>`
    );
  }
  const locationBlock =
    locParts.length > 0
      ? `<div style="margin-top:20px;padding:12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;">
           <div style="font-weight:bold;margin-bottom:8px;font-size: 13px;">Where &amp; how this waiver was signed</div>
           ${locParts.map((x) => `<div style="margin-bottom:6px;font-size: 13px;line-height:1.45;">${x}</div>`).join('')}
         </div>`
      : '';

  let intentAckHtml = '';
  if (Array.isArray(acks) && acks.length > 0 && includeIntentAckDetail) {
    intentAckHtml = `<div style="margin-top:20px;padding:12px;border:2px solid #1e3a5f;border-radius:6px;background:#f0f7ff;">
      <div style="font-weight:bold;margin-bottom:10px;font-size: 13px;color:#1e3a5f;">Additional Adult Liability Acknowledgment</div>
      <div style="margin:0 0 10px 0;font-size: 13px;line-height:1.55;color:#1e293b;">&#9745; I understand the additional adult must personally read and sign their own waiver.</div>
      <div style="padding:10px;background:#fff;border:1px solid #cbd5e1;border-radius:4px;font-size: 11px;line-height:1.6;color:#1e293b;">
        ${escapeHtml(disclaimerText || 'The primary signer confirmed the additional adult liability acknowledgment before adding another adult to this waiver.')}
      </div>
      <div style="margin-top:10px;font-size: 11px;color:#475569;">Disclaimer version: ${escapeHtml(ADDITIONAL_ADULT_INTENT_DISCLAIMER_VERSION)}.</div>
    </div>`;
  }

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/>
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.55; color: #111; margin: 0; padding: 16px; }
  .waiver-legal-body { margin: 16px 0; }
  .waiver-legal-body-preserve { white-space: break-spaces; word-break: break-word; }
  .waiver-legal-body p { margin: 0.5em 0; }
</style>
</head><body>
  ${hasAdditionalAdults ? ADDITIONAL_ADULT_EMAIL_BANNER_HTML : ''}
  <div style="text-align:center;border-bottom:2px solid #333;padding-bottom:12px;margin-bottom:20px;">
    ${logoUrl ? `<div style="margin-bottom:12px;"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(businessName || 'Business')} logo" style="max-width:140px;max-height:80px;" crossorigin="anonymous" /></div>` : ''}
    <div style="font-size: 18px;font-weight:bold;">${escapeHtml(businessName || 'Business')}</div>
    <div style="font-size: 16px;font-weight:bold;margin-top:8px;">${title}</div>
  </div>

  <h2 style="font-size: 14px;margin:20px 0 10px 0;">Waiver terms (full text)</h2>
  ${waiverBodyHtml(tpl.waiver_content)}

  <h2 style="font-size: 14px;margin:24px 0 10px 0;">Waiver Acknowledgments</h2>
  <div style="padding:12px;border:1px solid #d1d5db;border-radius:8px;background:#fafafa;">
    <div style="margin:6px 0;font-size: 13px;line-height:1.45;">${primaryWaiverTermsAccepted ? '&#9745;' : '&#9744;'} I agree to the waiver</div>
    <div style="margin:6px 0;font-size: 13px;line-height:1.45;">${primaryElectronicSignatureAccepted ? '&#9745;' : '&#9744;'} I agree to use an electronic signature</div>
    <div style="margin:6px 0;font-size: 13px;line-height:1.45;">${primaryMarketingAccepted ? '&#9745;' : '&#9744;'} I agree to marketing communications</div>
  </div>

  ${buildParticipantBlock('Children', minors)}

  <h2 style="font-size: 14px;margin:24px 0 10px 0;border-top:1px solid #ddd;padding-top:16px;">Primary Adult</h2>
  <div style="padding:14px;border:1px solid #dbe4ee;border-radius:8px;background:#fff;">
    <div style="font-weight:bold;font-size: 13px;margin-bottom:8px;">${escapeHtml(`${waiver.first_name || ''} ${waiver.last_name || ''}`.trim() || '—')}</div>
    <div style="font-size: 13px;line-height:1.6;">
      <div><strong>Date of birth:</strong> ${escapeHtml(formatDateOfBirthDisplay(waiver.date_of_birth, 'en-CA'))}</div>
      <div><strong>Email:</strong> ${escapeHtml(waiver.email || '—')}</div>
      <div><strong>Phone:</strong> ${escapeHtml(waiver.phone_number || '—')}</div>
      <div><strong>Mailing address:</strong> ${escapeHtml([waiver.address, waiver.city, waiver.postal_code].filter(Boolean).join(', ') || '—')}</div>
      <div><strong>Signed:</strong> ${escapeHtml(signedPrimary)}</div>
    </div>
    <div style="margin-top:10px;">
      <div style="margin-bottom:6px;font-size: 13px;line-height:1.45;">${primaryWaiverTermsAccepted ? '&#9745;' : '&#9744;'} I agree to the waiver</div>
      <div style="margin-bottom:6px;font-size: 13px;line-height:1.45;">${primaryElectronicSignatureAccepted ? '&#9745;' : '&#9744;'} I agree to use an electronic signature</div>
      <div style="margin-bottom:6px;font-size: 13px;line-height:1.45;">${primaryMarketingAccepted ? '&#9745;' : '&#9744;'} I agree to marketing communications</div>
      ${primarySigSrc
        ? `<img src="${escapeHtml(primarySigSrc)}" alt="Primary signature" style="max-width:280px;max-height:120px;border:1px solid #ccc;" crossorigin="anonymous" />`
        : '<div style="color:#666;font-size: 11px;">No signature image on file for primary signer.</div>'}
    </div>
  </div>

  ${locationBlock}
  ${intentAckHtml}
  ${buildParticipantBlock('Additional Adults', additionalAdults, { includeSignature: true, consentMap, additionalAdultAcks: acks })}

  <div style="margin-top:28px;padding-top:12px;border-top:1px solid #ddd;font-size: 10px;color:#666;">
    <p style="margin:4px 0;">Waiver ID: ${escapeHtml(String(waiver.id || ''))}</p>
    <p style="margin:4px 0;">Signed: ${escapeHtml(signedPrimary)}</p>
    <p style="margin:4px 0;">Generated for email/PDF: ${escapeHtml(new Date().toLocaleString('en-CA'))}</p>
  </div>
</body></html>`;
}
