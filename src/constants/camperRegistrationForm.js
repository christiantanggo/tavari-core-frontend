/** Default camp registration & medical form config (matches paper form layout). */

export const CAMPER_REGISTRATION_SECTION_KEYS = {
  camperInfo: 'camper_info',
  guardians: 'guardians',
  custody: 'custody',
  emergencyContacts: 'emergency_contacts',
  authorizedPickup: 'authorized_pickup',
  medicalInformation: 'medical_information',
  allergies: 'allergies',
  allergyMedAuthorization: 'allergy_med_authorization',
  medications: 'medications',
  campAuthorization: 'camp_authorization',
};

/** @deprecated Legacy keys — merged into new sections for older saved templates */
export const LEGACY_CAMPER_REGISTRATION_SECTION_KEYS = {
  authorizedPickups: 'authorized_pickups',
  medicalConditions: 'medical_conditions',
  dietaryRestrictions: 'dietary_restrictions',
  specialCareNotes: 'special_care_notes',
};

export const CUSTODY_OPTIONS = [
  { value: 'parent_guardian_1', label: 'Parent/Guardian 1' },
  { value: 'parent_guardian_2', label: 'Parent/Guardian 2' },
  { value: 'both', label: 'Both' },
  { value: 'joint', label: 'Joint' },
  { value: 'other', label: 'Other' },
];

export const DEFAULT_AUTHORIZATION_TEXTS = {
  camp:
    'I authorize my child to attend camp programs operated by this facility. I understand camp staff will follow emergency procedures as needed, and I agree to drop off and pick up my child at the designated times. I understand my child is expected to follow camp rules and staff directions while on site.',
  medical:
    'I authorize camp staff to administer medication as described on this form and to provide first aid or seek emergency medical care for my child if needed. I release the camp, its staff, and operators from liability for injury or illness except where prohibited by law, when such care is provided in good faith.',
  off_premises:
    'I authorize my child to participate in supervised off-premises activities and field trips organized by camp staff. I understand reasonable safety measures will be taken and release the camp from liability related to these supervised activities except where prohibited by law.',
  allergy_med_admin:
    'I authorize camp staff to administer medication for allergies or other medical needs as described on this form. I understand each medication must be supplied in its original container with clear labelling and instructions.',
};

export const DEFAULT_CAMPER_REGISTRATION_TEMPLATE = {
  form_title: 'Camp Registration & Medical Form',
  form_intro:
    'Complete this form once per camper each year before attending camp. All sections must be filled out accurately.',
  expiry_days: 365,
  fields_config: {
    sections: {
      [CAMPER_REGISTRATION_SECTION_KEYS.camperInfo]: {
        enabled: true,
        required: true,
        label: 'Camper information',
      },
      [CAMPER_REGISTRATION_SECTION_KEYS.guardians]: {
        enabled: true,
        required: true,
        label: 'Parent/guardian information',
      },
      [CAMPER_REGISTRATION_SECTION_KEYS.custody]: {
        enabled: true,
        required: true,
        label: 'Custody of camper',
      },
      [CAMPER_REGISTRATION_SECTION_KEYS.emergencyContacts]: {
        enabled: true,
        required: false,
        label: 'Emergency contact',
        max_items: 2,
        helper_text: 'Other than parent/guardian',
      },
      [CAMPER_REGISTRATION_SECTION_KEYS.authorizedPickup]: {
        enabled: true,
        required: true,
        label: 'Authorized pick-up',
        pickup_id_note:
          'Staff will verify photo ID at pickup. We do not store photos of government IDs.',
      },
      [CAMPER_REGISTRATION_SECTION_KEYS.medicalInformation]: {
        enabled: true,
        required: false,
        label: 'Medical information',
        prompt:
          "Please describe any allergies or medical needs your child's camp staff should know about:",
      },
      [CAMPER_REGISTRATION_SECTION_KEYS.allergies]: {
        enabled: true,
        required: false,
        label: 'Allergy information',
      },
      [CAMPER_REGISTRATION_SECTION_KEYS.allergyMedAuthorization]: {
        enabled: true,
        required: false,
        label: 'Allergy medication authorization',
      },
      [CAMPER_REGISTRATION_SECTION_KEYS.medications]: {
        enabled: true,
        required: false,
        label: 'Medication information',
      },
      [CAMPER_REGISTRATION_SECTION_KEYS.campAuthorization]: {
        enabled: true,
        required: true,
        label: 'Camp & medical authorization',
      },
    },
    authorization_texts: { ...DEFAULT_AUTHORIZATION_TEXTS },
    custom_fields: [],
  },
};

function mergeSections(baseSections, incomingSections) {
  const merged = { ...baseSections };
  if (incomingSections && typeof incomingSections === 'object') {
    Object.entries(incomingSections).forEach(([key, value]) => {
      merged[key] = { ...merged[key], ...value };
    });
  }
  return merged;
}

export function mergeCamperRegistrationTemplate(row) {
  if (!row) {
    return JSON.parse(JSON.stringify(DEFAULT_CAMPER_REGISTRATION_TEMPLATE));
  }
  const base = DEFAULT_CAMPER_REGISTRATION_TEMPLATE;
  const incoming = row.fields_config && typeof row.fields_config === 'object' ? row.fields_config : {};
  return {
    form_title: row.form_title || base.form_title,
    form_intro: row.form_intro ?? base.form_intro,
    expiry_days: row.expiry_days || base.expiry_days,
    fields_config: {
      ...base.fields_config,
      ...incoming,
      sections: mergeSections(base.fields_config.sections, incoming.sections),
      authorization_texts: {
        ...base.fields_config.authorization_texts,
        ...(incoming.authorization_texts || {}),
      },
      custom_fields: Array.isArray(incoming.custom_fields) ? incoming.custom_fields : [],
    },
  };
}

export function sectionEnabled(template, key) {
  return template?.fields_config?.sections?.[key]?.enabled !== false;
}

export function sectionRequired(template, key) {
  const section = template?.fields_config?.sections?.[key];
  if (!section || section.enabled === false) return false;
  return section.required !== false;
}

export function sectionPrompt(template, key, fallback = '') {
  return template?.fields_config?.sections?.[key]?.prompt || fallback;
}

/** Compute age in whole years from a date-of-birth string. */
export function sectionLabel(template, key, fallback = '') {
  return template?.fields_config?.sections?.[key]?.label || fallback;
}

export function sectionField(template, key, field, fallback = '') {
  const value = template?.fields_config?.sections?.[key]?.[field];
  return value != null && value !== '' ? value : fallback;
}

/** Ordered section keys for builder + customer form */
export const CAMPER_REGISTRATION_SECTION_ORDER = [
  CAMPER_REGISTRATION_SECTION_KEYS.camperInfo,
  CAMPER_REGISTRATION_SECTION_KEYS.guardians,
  CAMPER_REGISTRATION_SECTION_KEYS.custody,
  CAMPER_REGISTRATION_SECTION_KEYS.emergencyContacts,
  CAMPER_REGISTRATION_SECTION_KEYS.authorizedPickup,
  CAMPER_REGISTRATION_SECTION_KEYS.medicalInformation,
  CAMPER_REGISTRATION_SECTION_KEYS.allergies,
  CAMPER_REGISTRATION_SECTION_KEYS.allergyMedAuthorization,
  CAMPER_REGISTRATION_SECTION_KEYS.medications,
  CAMPER_REGISTRATION_SECTION_KEYS.campAuthorization,
];

export function computeAgeFromDob(dateOfBirth) {
  if (!dateOfBirth) return '';
  const dob = new Date(String(dateOfBirth).split('T')[0]);
  if (Number.isNaN(dob.getTime())) return '';
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age >= 0 ? String(age) : '';
}

export const CAMPER_REGISTRATION_PREVIEW_SAMPLE = {
  participant: {
    id: 'preview',
    first_name: 'Sample',
    last_name: 'Camper',
    date_of_birth: '2020-05-29',
  },
  customerAccount: {
    id: 'preview',
    customer_name: 'Sample Parent',
    customer_phone: '555-555-0100',
    customer_email: 'parent@example.com',
  },
};

export function camperRegistrationPreviewStorageKey(businessId) {
  return `camper-reg-preview:${businessId}`;
}

/** localStorage is shared across tabs; sessionStorage is not (breaks window.open preview). */
export function readCamperRegistrationPreviewPayload(businessId) {
  if (!businessId || typeof window === 'undefined') return null;
  try {
    const key = camperRegistrationPreviewStorageKey(businessId);
    const raw =
      window.localStorage.getItem(key) ||
      window.sessionStorage.getItem(`camper-reg-preview-${businessId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeCamperRegistrationPreviewPayload(businessId, payload) {
  if (!businessId || typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(
      camperRegistrationPreviewStorageKey(businessId),
      JSON.stringify(payload)
    );
    return true;
  } catch {
    return false;
  }
}

export function getBusinessWebsiteUrl(businessWebsite) {
  const raw = String(businessWebsite || '').trim();
  if (!raw) return null;
  return raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
}

export function getCampRegistrationPortalPath(businessId) {
  if (!businessId) return '/';
  return `/customer-portal/${businessId}/camp-registration`;
}

export function getCampRegistrationPortalUrl(businessId) {
  if (typeof window === 'undefined') return getCampRegistrationPortalPath(businessId);
  return `${window.location.origin}${getCampRegistrationPortalPath(businessId)}`;
}

function escapeHtmlForEmail(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildCampRegistrationShareEmail({ businessName, businessId, formTitle, recipientName }) {
  const url = getCampRegistrationPortalUrl(businessId);
  const title = formTitle || 'Camp registration & medical form';
  const name = businessName || 'Our facility';
  const greeting = recipientName ? `Hello ${recipientName},` : 'Hello,';
  const introLines = [
    greeting,
    '',
    `Please complete the annual ${title.toLowerCase()} for your camper(s) before their next visit.`,
    '',
    'Sign in with the phone number on your account, then select each child to complete or update their form.',
  ];
  return {
    subject: `${name} — ${title}`,
    portalUrl: url,
    formTitle: title,
    businessName: name,
    body: [
      ...introLines,
      '',
      url,
      '',
      'Thank you,',
      name,
    ].join('\n'),
    introText: introLines.join('\n'),
  };
}

/** Styled like Tavari Reminder emails (card layout, teal header, pill CTA). */
export function buildCampRegistrationShareEmailHtml({
  businessName,
  formTitle,
  introText,
  portalUrl,
}) {
  const accent = '#0f766e';
  const buttonWidthPx = 280;
  const title = formTitle || 'Camp registration & medical form';
  const name = businessName || 'Our facility';
  const bodyHtml = escapeHtmlForEmail(introText).replace(/\n/g, '<br/>');
  const buttonStyle = [
    'display:block',
    `width:${buttonWidthPx}px`,
    'max-width:100%',
    'margin:0 auto',
    'box-sizing:border-box',
    'text-align:center',
    `background:${accent}`,
    'color:#ffffff',
    'text-decoration:none',
    'font-weight:700',
    'font-size: 14px',
    'padding:12px 20px',
    'border-radius:999px',
  ].join(';');

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,0.10);">
            <tr>
              <td style="background:${accent};padding:28px 32px;color:#ffffff;">
                <div style="font-size: 13px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;opacity:0.9;">${escapeHtmlForEmail(name)}</div>
                <h1 style="margin:10px 0 0;font-size: 26px;line-height:1.2;font-weight:800;">${escapeHtmlForEmail(title)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 32px 8px;">
                <p style="margin:0;color:#374151;font-size: 16px;line-height:1.6;">${bodyHtml}</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 32px 0;">
                <a href="${escapeHtmlForEmail(portalUrl)}" style="${buttonStyle}">
                  Complete registration form
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px;">
                <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:16px;font-size: 13px;color:#6b7280;line-height:1.5;">
                  This message was sent by <strong style="color:#111827;">${escapeHtmlForEmail(name)}</strong> through Tavari.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function applyCamperRegistrationPreviewSample(setters) {
  const { participant, customerAccount } = CAMPER_REGISTRATION_PREVIEW_SAMPLE;
  if (participant?.date_of_birth && setters.setAgeAtCamp) {
    setters.setAgeAtCamp(computeAgeFromDob(participant.date_of_birth));
  }
  const ca = customerAccount;
  if (ca && setters.setCamperHomePhone) {
    setters.setCamperHomePhone(ca.customer_phone || ca.phone || '');
  }
  if (ca && setters.setGuardian1) {
    setters.setGuardian1({
      name: ca.customer_name || '',
      primary_phone: ca.customer_phone || ca.phone || '',
      secondary_phone: '',
      email: ca.customer_email || ca.email || '',
    });
  }
  if (ca && setters.setSignedByName) {
    setters.setSignedByName(ca.customer_name || '');
  }
}
