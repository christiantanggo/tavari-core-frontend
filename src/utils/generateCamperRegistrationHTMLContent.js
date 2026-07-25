import { DEFAULT_AUTHORIZATION_TEXTS } from '../constants/camperRegistrationForm';
import { formatPostalCodeDisplay } from './postalFormat';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parsePrintDate(value) {
  if (value == null || value === '') return null;
  const str = String(value).trim();
  const isoDate = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) {
    const [, y, m, d] = isoDate;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(value) {
  const d = parsePrintDate(value);
  if (!d) return value ? esc(String(value).split('T')[0]) : '—';
  const month = d.toLocaleDateString('en-US', { month: 'long' });
  const day = d.getDate();
  const year = d.getFullYear();
  return esc(`${month} ${day} ${year}`);
}

function fmtDateTime(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const month = d.toLocaleDateString('en-US', { month: 'long' });
  const day = d.getDate();
  const year = d.getFullYear();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return esc(`${month} ${day} ${year}, ${time}`);
}

function yesNo(value) {
  if (value === 'yes') return 'Yes';
  if (value === 'no') return 'No';
  return '—';
}

function row(label, value) {
  return `<tr><th>${esc(label)}</th><td>${esc(value || '—')}</td></tr>`;
}

function section(title, bodyHtml) {
  if (!bodyHtml?.trim()) return '';
  return `
    <div class="cr-section">
      <div class="cr-section-title">${esc(title)}</div>
      ${bodyHtml}
    </div>`;
}

function table(headers, rowsHtml, { notApplicable = false } = {}) {
  if (notApplicable) return '<p class="cr-empty">N/A</p>';
  if (!rowsHtml?.trim()) return '<p class="cr-empty">None listed</p>';
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  return `<table class="cr-table"><thead><tr>${head}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

function textBlock(value, { notApplicable = false } = {}) {
  if (notApplicable) return '<p class="cr-empty">N/A</p>';
  const text = String(value ?? '').trim();
  if (!text) return '<p class="cr-empty">None listed</p>';
  return `<div class="cr-text-block">${esc(text)}</div>`;
}

function safeImageSrc(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const src = value.trim();
  if (src.startsWith('data:image/') || src.startsWith('http://') || src.startsWith('https://')) {
    return src.replace(/"/g, '&quot;');
  }
  return '';
}

/** Resolve signature image src from stored document fields (handles legacy nested formats). */
export function resolveCamperRegistrationSignatureSrc(doc) {
  const candidates = [];

  const push = (value) => {
    if (typeof value === 'string' && value.trim()) candidates.push(value.trim());
  };

  const url = doc?.signature_image_url;
  if (typeof url === 'string' && url.trim()) {
    const trimmed = url.trim();
    if (trimmed.startsWith('data:') || trimmed.startsWith('http')) {
      push(trimmed);
    } else if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        push(parsed?.imageUrl);
        push(parsed?.imageData);
      } catch {
        // ignore malformed JSON
      }
    }
  }

  let sd = doc?.signature_data;
  if (typeof sd === 'string') {
    try {
      sd = JSON.parse(sd);
    } catch {
      push(sd.startsWith('data:') ? sd : null);
      sd = null;
    }
  }

  if (sd && typeof sd === 'object') {
    const dataUrl = sd.dataUrl;
    if (typeof dataUrl === 'string') {
      push(dataUrl);
    } else if (dataUrl && typeof dataUrl === 'object') {
      push(dataUrl.imageData);
      push(dataUrl.imageUrl);
    }
    push(sd.imageData);
    push(sd.imageUrl);
  }

  return candidates.find((c) => c.startsWith('data:image/') || c.startsWith('http')) || '';
}

/**
 * Printable camp registration & medical form HTML (Tavari document style).
 */
export function generateCamperRegistrationHTMLContent({
  document: doc,
  businessName = '',
  formTitle = 'Camp Registration & Medical Form',
  authorizationTexts = DEFAULT_AUTHORIZATION_TEXTS,
  generatedByLabel = 'Tavari Bookings',
}) {
  const fd = doc?.form_data || {};
  const sectionNa = fd.section_na && typeof fd.section_na === 'object' ? fd.section_na : {};
  const camper = fd.camper_info || {};
  const guardians = fd.guardians || {};
  const g1 = guardians.guardian_1 || {};
  const g2 = guardians.guardian_2 || {};
  const custody = fd.custody || {};
  const pickup = fd.authorized_pickup || {};
  const allergies = fd.allergies || doc?.medical_summary?.allergies || [];
  const medications = fd.medications || doc?.medical_summary?.medications || [];
  const emergencyContacts = fd.emergency_contacts || [];
  const authTexts = { ...DEFAULT_AUTHORIZATION_TEXTS, ...authorizationTexts };
  const camperName = [doc?.first_name, doc?.last_name].filter(Boolean).join(' ').trim();

  const custodyLabels = {
    parent_guardian_1: 'Parent/Guardian 1',
    parent_guardian_2: 'Parent/Guardian 2',
    both: 'Both',
    joint: 'Joint',
    other: custody.other_detail ? `Other: ${custody.other_detail}` : 'Other',
  };

  const pickupParts = [];
  if (pickup.parent_guardians) pickupParts.push('Parent/Guardian(s)');
  if (pickup.emergency_contacts) pickupParts.push('Emergency contact(s)');
  if (pickup.other_detail) pickupParts.push(`Other: ${pickup.other_detail}`);

  const allergyRows = (allergies || [])
    .map(
      (a) => `<tr>
        <td>${esc(a.allergen)}</td>
        <td>${esc(a.potential_symptoms)}</td>
        <td>${esc(a.other)}</td>
        <td>${yesNo(a.is_anaphylactic)}</td>
        <td>${yesNo(a.has_epipen)}</td>
      </tr>`
    )
    .join('');

  const medRows = (medications || [])
    .map(
      (m) => `<tr>
        <td>${esc(m.name)}</td>
        <td>${esc(m.dosage_instructions)}</td>
        <td>${esc(m.time_to_dispense)}</td>
        <td>${yesNo(m.refrigeration)}</td>
      </tr>`
    )
    .join('');

  const emergencyRows = (emergencyContacts || [])
    .map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.phone)}</td></tr>`)
    .join('');

  const authorizedList = (doc?.authorized_pickups || [])
    .map((p) => `<li>${esc(p.name)}${p.relationship ? ` (${esc(p.relationship)})` : ''}</li>`)
    .join('');

  const signatureImg = resolveCamperRegistrationSignatureSrc(doc);
  const signatureSrc = safeImageSrc(signatureImg);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(formTitle)} — ${esc(camperName)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 14px;
      color: #1f2937;
      margin: 0;
      padding: 24px;
      line-height: 1.45;
    }
    .cr-header {
      border-bottom: 3px solid #0d9488;
      padding-bottom: 12px;
      margin-bottom: 18px;
    }
    .cr-business { font-size: 16px; font-weight: 700; color: #0f766e; text-transform: uppercase; letter-spacing: 0.5px; }
    .cr-title { font-size: 23px; font-weight: 700; margin-top: 6px; color: #111827; }
    .cr-meta { display: flex; flex-wrap: wrap; gap: 24px; margin-top: 10px; font-size: 14px; }
    .cr-meta-block strong { display: block; color: #374151; margin-bottom: 2px; }
    .cr-section { margin-bottom: 16px; page-break-inside: avoid; }
    .cr-section-title {
      background: #0d9488;
      color: #fff;
      font-weight: 700;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      padding: 6px 10px;
      margin-bottom: 8px;
    }
    .cr-table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
    .cr-table th, .cr-table td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; vertical-align: top; }
    .cr-table th { background: #f3f4f6; font-weight: 600; width: 28%; }
    .cr-table thead th { background: #ecfdf5; width: auto; }
    .cr-kv th { width: 32%; }
    .cr-empty { color: #6b7280; font-style: italic; margin: 0; }
    .cr-text-block { white-space: pre-wrap; padding: 8px; border: 1px solid #e5e7eb; background: #fafafa; border-radius: 4px; }
    .cr-auth-block { margin-bottom: 10px; padding: 8px; border: 1px solid #e5e7eb; border-radius: 4px; }
    .cr-auth-block h4 { margin: 0 0 6px; font-size: 14px; color: #0f766e; }
    .cr-signature { margin-top: 12px; }
    .cr-signature img { max-width: 280px; max-height: 80px; border: 1px solid #d1d5db; background: #fff; }
    .cr-footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 13px; color: #6b7280; }
    .cr-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media print { body { padding: 12px; } }
  </style>
</head>
<body>
  <div class="cr-header">
    <div class="cr-business">${esc(businessName)}</div>
    <div class="cr-title">${esc(formTitle)}</div>
    <div class="cr-meta">
      <div class="cr-meta-block"><strong>Camper</strong>${esc(camperName)}</div>
      <div class="cr-meta-block"><strong>Date of birth</strong>${fmtDate(doc?.date_of_birth)}</div>
      <div class="cr-meta-block"><strong>Signed</strong>${fmtDate(doc?.signed_at)}</div>
      <div class="cr-meta-block"><strong>Valid until</strong>${fmtDate(doc?.expires_at)}</div>
      <div class="cr-meta-block"><strong>Signed by</strong>${esc(doc?.signed_by_name)}${doc?.signed_by_relationship ? ` (${esc(doc.signed_by_relationship)})` : ''}</div>
    </div>
  </div>

  ${section(
    'Camper information',
    `<table class="cr-table cr-kv">
      ${row('Address', camper.address)}
      ${row('City', camper.city)}
      ${row('Postal code', formatPostalCodeDisplay(camper.postal_code))}
      ${row('Home phone', camper.home_phone)}
      ${row('Age at camp', camper.age_at_camp)}
    </table>`
  )}

  ${section(
    'Parent/guardian information',
    `<div class="cr-two-col">
      <table class="cr-table cr-kv">
        ${row('Parent/Guardian 1', g1.name)}
        ${row('Primary phone', g1.primary_phone)}
        ${row('Secondary phone', g1.secondary_phone)}
        ${row('Email', g1.email)}
      </table>
      ${
        sectionNa.guardian_2
          ? '<p class="cr-empty">Parent/Guardian 2: N/A</p>'
          : `<table class="cr-table cr-kv">
        ${row('Parent/Guardian 2', g2.name)}
        ${row('Primary phone', g2.primary_phone)}
        ${row('Secondary phone', g2.secondary_phone)}
        ${row('Email', g2.email)}
      </table>`
      }
    </div>`
  )}

  ${section(
    'Custody of camper',
    `<table class="cr-table cr-kv">${row('Custody', custodyLabels[custody.type] || custody.type || '—')}</table>`
  )}

  ${section(
    'Emergency contact',
    table(['Name', 'Preferred contact number'], emergencyRows, {
      notApplicable: sectionNa.emergency_contacts === true,
    })
  )}

  ${section(
    'Authorized pick-up',
    `<table class="cr-table cr-kv">${row('Authorized', pickupParts.join(', ') || '—')}</table>
     ${authorizedList ? `<ul style="margin:8px 0 0;padding-left:18px;">${authorizedList}</ul>` : ''}`
  )}

  ${section(
    'Medical information',
    textBlock(fd.medical_needs || doc?.medical_summary?.medical_needs, {
      notApplicable: sectionNa.medical_information === true,
    })
  )}

  ${section(
    'Allergy information',
    table(['Allergen', 'Potential symptoms', 'Other', 'Anaphylactic', 'Epi-Pen'], allergyRows, {
      notApplicable: sectionNa.allergies === true,
    })
  )}

  ${section(
    'Medication information',
    table(['Medication', 'Dosage / instructions', 'Time to dispense', 'Refrigeration'], medRows, {
      notApplicable: sectionNa.medications === true,
    })
  )}

  ${section(
    'Camp & medical authorization',
    `<div class="cr-auth-block"><h4>Camp authorization</h4><p>${esc(authTexts.camp)}</p></div>
     <div class="cr-auth-block"><h4>Medical authorization</h4><p>${esc(authTexts.medical)}</p></div>
     <div class="cr-auth-block"><h4>Off premises activities</h4><p>${esc(authTexts.off_premises)}</p></div>
     <div class="cr-signature">
       <strong>Signature of parent/guardian</strong><br/>
       ${signatureSrc ? `<img src="${signatureSrc}" alt="Signature" />` : '<span class="cr-empty">No signature on file</span>'}
     </div>`
  )}

  <div class="cr-footer">
    <p><strong>This document was generated electronically by ${esc(generatedByLabel)}.</strong></p>
    <p>Document ID: ${esc(doc?.id || '—')} · Generated ${fmtDateTime(new Date())}</p>
  </div>
</body>
</html>`;
}
