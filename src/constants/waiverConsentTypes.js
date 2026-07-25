// Aligns with DB: waiver_consents.consent_type CHECK (see supabase migrations).

export const WAIVER_AUDIT_CONSENT_TYPES = [
  'marketing',
  'photography',
  'medical',
  'other',
  'waiver_terms',
  'electronic_signature',
  'additional_adult_intent'
];

export const WAIVER_AUDIT_CONSENT_TYPE_SET = new Set(WAIVER_AUDIT_CONSENT_TYPES);

/** CSV column headers for audit exports */
export const WAIVER_CONSENT_CSV_HEADERS = {
  marketing: 'Consent marketing (Y/N)',
  photography: 'Consent photography (Y/N)',
  medical: 'Consent medical (Y/N)',
  other: 'Consent other (Y/N)',
  waiver_terms: 'Ack waiver terms read (Y/N)',
  electronic_signature: 'Ack electronic signature (Y/N)',
  additional_adult_intent: 'Ack additional adult intent (Y/N)',
  additional_adult_intent_detail: 'Additional adult intent detail (JSON)'
};

/**
 * Rows to insert into waiver_consents after a successful signing.
 * @param {string} waiverId
 * @param {Record<string, boolean>} consentStates - optional consents from WaiverConsentCheckboxes
 * @param {{ additionalAdultIntentAcknowledgments?: object[], acknowledgedAt?: string }} options
 */
export function waiverConsentTypeLabel(type) {
  const labels = {
    marketing: 'Marketing',
    photography: 'Photography',
    medical: 'Medical',
    other: 'Other',
    waiver_terms: 'Waiver terms read and agreed',
    electronic_signature: 'Electronic signature acknowledgement',
    additional_adult_intent: 'Additional adult intent'
  };
  return labels[type] || type;
}

export function buildWaiverConsentInsertRows(waiverId, consentStates, options = {}) {
  const { additionalAdultIntentAcknowledgments = [], acknowledgedAt } = options;
  const at = acknowledgedAt || new Date().toISOString();
  const acks = Array.isArray(additionalAdultIntentAcknowledgments)
    ? additionalAdultIntentAcknowledgments
    : [];

  const merged = {
    ...(consentStates && typeof consentStates === 'object' ? consentStates : {})
  };

  merged.waiver_terms = true;
  merged.electronic_signature = true;
  if (acks.length > 0) {
    merged.additional_adult_intent = true;
  }

  const rows = [];
  for (const consentType of WAIVER_AUDIT_CONSENT_TYPES) {
    if (!Object.prototype.hasOwnProperty.call(merged, consentType)) continue;
    const given = !!merged[consentType];
    const row = {
      waiver_id: waiverId,
      consent_type: consentType,
      consent_given: given,
      acknowledged_at: at
    };
    if (consentType === 'additional_adult_intent' && given && acks.length > 0) {
      row.consent_text = JSON.stringify(acks);
    }
    rows.push(row);
  }
  return rows;
}
