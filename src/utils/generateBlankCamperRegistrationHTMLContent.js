import {
  CAMPER_REGISTRATION_SECTION_KEYS as SK,
  CUSTODY_OPTIONS,
  DEFAULT_AUTHORIZATION_TEXTS,
  DEFAULT_CAMPER_REGISTRATION_TEMPLATE,
  mergeCamperRegistrationTemplate,
  sectionEnabled,
  sectionField,
  sectionLabel,
  sectionPrompt,
} from '../constants/camperRegistrationForm';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function blankLine(minHeight = 22) {
  return `<div class="cr-write-line" style="min-height:${minHeight}px"></div>`;
}

function blankBox(rows = 3) {
  return `<div class="cr-write-box" style="min-height:${rows * 22}px"></div>`;
}

function kvRow(label, lineHeight = 22) {
  return `<tr><th>${esc(label)}</th><td>${blankLine(lineHeight)}</td></tr>`;
}

function section(title, bodyHtml) {
  if (!bodyHtml?.trim()) return '';
  return `
    <div class="cr-section">
      <div class="cr-section-title">${esc(title)}</div>
      ${bodyHtml}
    </div>`;
}

function emptyTable(headers, rowCount, cellsPerRow) {
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const rows = Array.from({ length: rowCount }, () => {
    const cells = Array.from({ length: cellsPerRow }, () => `<td>${blankLine(20)}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<table class="cr-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function checkboxLine(label) {
  return `<label class="cr-check"><span class="cr-box"></span> ${esc(label)}</label>`;
}

/**
 * Printable blank camp registration form for handwritten fill-out.
 * Uses the business template for titles, section labels, and authorization text.
 */
export function generateBlankCamperRegistrationHTMLContent({
  businessName = '',
  template: rawTemplate = null,
  generatedByLabel = 'Tavari Bookings',
} = {}) {
  const template = mergeCamperRegistrationTemplate(rawTemplate || DEFAULT_CAMPER_REGISTRATION_TEMPLATE);
  const formTitle = template.form_title || DEFAULT_CAMPER_REGISTRATION_TEMPLATE.form_title;
  const formIntro = template.form_intro || '';
  const authTexts = {
    ...DEFAULT_AUTHORIZATION_TEXTS,
    ...(template.fields_config?.authorization_texts || {}),
  };
  const customFields = Array.isArray(template.fields_config?.custom_fields)
    ? template.fields_config.custom_fields.filter((f) => f?.field_label?.trim())
    : [];

  const medicalPrompt = sectionPrompt(
    template,
    SK.medicalInformation,
    "Please describe any allergies or medical needs your child's camp staff should know about:"
  );
  const pickupNote = sectionField(
    template,
    SK.authorizedPickup,
    'pickup_id_note',
    'Staff will verify photo ID at pickup. We do not store photos of government IDs.'
  );
  const emergencyHelper = sectionField(template, SK.emergencyContacts, 'helper_text', 'Other than parent/guardian');

  const parts = [];

  if (sectionEnabled(template, SK.camperInfo)) {
    parts.push(
      section(
        sectionLabel(template, SK.camperInfo, 'Camper information'),
        `<table class="cr-table cr-kv">
          ${kvRow('Camper first name')}
          ${kvRow('Camper last name')}
          ${kvRow('Date of birth')}
          ${kvRow('Address')}
          ${kvRow('City')}
          ${kvRow('Postal code')}
          ${kvRow('Home phone')}
          ${kvRow('Age at camp')}
        </table>`
      )
    );
  }

  if (sectionEnabled(template, SK.guardians)) {
    parts.push(
      section(
        sectionLabel(template, SK.guardians, 'Parent/guardian information'),
        `<div class="cr-two-col">
          <table class="cr-table cr-kv">
            ${kvRow('Parent/Guardian 1 name')}
            ${kvRow('Primary phone')}
            ${kvRow('Secondary phone')}
            ${kvRow('Email')}
          </table>
          <table class="cr-table cr-kv">
            ${kvRow('Parent/Guardian 2 name')}
            ${kvRow('Primary phone')}
            ${kvRow('Secondary phone')}
            ${kvRow('Email')}
          </table>
        </div>
        <p class="cr-hint">Check N/A if there is no Parent/Guardian 2: ${checkboxLine('N/A')}</p>`
      )
    );
  }

  if (sectionEnabled(template, SK.custody)) {
    parts.push(
      section(
        sectionLabel(template, SK.custody, 'Custody of camper'),
        `<div class="cr-check-row">
          ${CUSTODY_OPTIONS.map((opt) => checkboxLine(opt.label)).join('')}
        </div>
        <table class="cr-table cr-kv" style="margin-top:8px">${kvRow('If Other, describe')}</table>`
      )
    );
  }

  if (sectionEnabled(template, SK.emergencyContacts)) {
    parts.push(
      section(
        sectionLabel(template, SK.emergencyContacts, 'Emergency contact'),
        `<p class="cr-hint">${esc(emergencyHelper)}</p>
         ${emptyTable(['Name', 'Preferred contact number'], 2, 2)}
         <p class="cr-hint" style="margin-top:8px">${checkboxLine('N/A — no emergency contacts other than parent/guardian')}</p>`
      )
    );
  }

  if (sectionEnabled(template, SK.authorizedPickup)) {
    parts.push(
      section(
        sectionLabel(template, SK.authorizedPickup, 'Authorized pick-up'),
        `<div class="cr-check-row">
          ${checkboxLine('Parent/Guardian(s)')}
          ${checkboxLine('Emergency contact(s)')}
          ${checkboxLine('Other (list below)')}
        </div>
        <p class="cr-hint" style="margin-top:8px">${esc(pickupNote)}</p>
        <p class="cr-sub">Other authorized people (name / relationship)</p>
        ${blankBox(3)}`
      )
    );
  }

  if (sectionEnabled(template, SK.medicalInformation)) {
    parts.push(
      section(
        sectionLabel(template, SK.medicalInformation, 'Medical information'),
        `<p class="cr-hint">${esc(medicalPrompt)}</p>
         ${blankBox(4)}
         <p class="cr-hint" style="margin-top:8px">${checkboxLine('N/A — none')}</p>`
      )
    );
  }

  if (sectionEnabled(template, SK.allergies)) {
    parts.push(
      section(
        sectionLabel(template, SK.allergies, 'Allergy information'),
        `${emptyTable(['Allergen', 'Potential symptoms', 'Other', 'Anaphylactic Y/N', 'Epi-Pen Y/N'], 3, 5)}
         <p class="cr-hint" style="margin-top:8px">${checkboxLine('N/A — no known allergies')}</p>`
      )
    );
  }

  if (sectionEnabled(template, SK.allergyMedAuthorization)) {
    parts.push(
      section(
        sectionLabel(template, SK.allergyMedAuthorization, 'Allergy medication authorization'),
        `<div class="cr-auth-block"><p>${esc(authTexts.allergy_med_admin)}</p></div>
         <p class="cr-hint">${checkboxLine('I acknowledge and authorize as described above')}</p>`
      )
    );
  }

  if (sectionEnabled(template, SK.medications)) {
    parts.push(
      section(
        sectionLabel(template, SK.medications, 'Medication information'),
        `${emptyTable(['Medication', 'Dosage / instructions', 'Time to dispense', 'Refrigeration Y/N'], 3, 4)}
         <p class="cr-hint" style="margin-top:8px">${checkboxLine('N/A — no medications')}</p>`
      )
    );
  }

  if (customFields.length > 0) {
    const customRows = customFields
      .map((field) => {
        const label = `${field.field_label}${field.is_required ? ' *' : ''}`;
        if (field.field_type === 'checkbox') {
          return `<tr><th>${esc(label)}</th><td>${checkboxLine('Yes')} ${checkboxLine('No')}</td></tr>`;
        }
        if (field.field_type === 'textarea') {
          return `<tr><th>${esc(label)}</th><td>${blankBox(2)}</td></tr>`;
        }
        return kvRow(label);
      })
      .join('');
    parts.push(section('Additional questions', `<table class="cr-table cr-kv">${customRows}</table>`));
  }

  if (sectionEnabled(template, SK.campAuthorization)) {
    parts.push(
      section(
        sectionLabel(template, SK.campAuthorization, 'Camp & medical authorization'),
        `<div class="cr-auth-block"><h4>Camp authorization</h4><p>${esc(authTexts.camp)}</p>
           <p class="cr-hint">${checkboxLine('I acknowledge and agree')}</p></div>
         <div class="cr-auth-block"><h4>Medical authorization</h4><p>${esc(authTexts.medical)}</p>
           <p class="cr-hint">${checkboxLine('I acknowledge and agree')}</p></div>
         <div class="cr-auth-block"><h4>Off premises activities</h4><p>${esc(authTexts.off_premises)}</p>
           <p class="cr-hint">${checkboxLine('I acknowledge and agree')}</p></div>
         <div class="cr-signature-block">
           <table class="cr-table cr-kv">
             ${kvRow('Print name of parent/guardian')}
             ${kvRow('Relationship to camper')}
             ${kvRow('Date signed')}
           </table>
           <p class="cr-sub" style="margin-top:12px"><strong>Signature of parent/guardian</strong></p>
           <div class="cr-signature-line"></div>
         </div>`
      )
    );
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(formTitle)} — Blank form</title>
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
    .cr-intro { margin-top: 8px; color: #4b5563; font-size: 14px; }
    .cr-badge {
      display: inline-block;
      margin-top: 10px;
      padding: 4px 10px;
      border-radius: 999px;
      background: #ecfdf5;
      color: #0f766e;
      font-weight: 700;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
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
    .cr-write-line {
      border-bottom: 1px solid #9ca3af;
      width: 100%;
    }
    .cr-write-box {
      border: 1px solid #d1d5db;
      background: #fff;
      border-radius: 2px;
    }
    .cr-hint { margin: 0; color: #4b5563; }
    .cr-sub { margin: 8px 0 4px; font-weight: 600; color: #374151; }
    .cr-check {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-right: 14px;
      margin-bottom: 6px;
      white-space: nowrap;
    }
    .cr-check-row { display: flex; flex-wrap: wrap; gap: 4px 8px; }
    .cr-box {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 1.5px solid #374151;
      background: #fff;
      flex-shrink: 0;
    }
    .cr-auth-block { margin-bottom: 10px; padding: 8px; border: 1px solid #e5e7eb; border-radius: 4px; }
    .cr-auth-block h4 { margin: 0 0 6px; font-size: 14px; color: #0f766e; }
    .cr-auth-block p { margin: 0 0 8px; }
    .cr-signature-line {
      margin-top: 8px;
      height: 56px;
      border: 1px solid #9ca3af;
      border-radius: 2px;
      background: #fff;
    }
    .cr-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .cr-footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 13px; color: #6b7280; }
    @media print {
      body { padding: 12px; }
      .cr-section { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="cr-header">
    <div class="cr-business">${esc(businessName)}</div>
    <div class="cr-title">${esc(formTitle)}</div>
    ${formIntro ? `<p class="cr-intro">${esc(formIntro)}</p>` : ''}
    <div class="cr-badge">Paper form — complete by hand</div>
  </div>

  ${parts.join('\n')}

  <div class="cr-footer">
    <p><strong>Blank form printed from ${esc(generatedByLabel)}.</strong></p>
    <p>Please complete all sections accurately. Return this form to camp staff when finished.</p>
  </div>
</body>
</html>`;
}
