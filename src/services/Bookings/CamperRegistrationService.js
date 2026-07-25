import { supabase } from '../../supabaseClient';
import {
  DEFAULT_CAMPER_REGISTRATION_TEMPLATE,
  mergeCamperRegistrationTemplate,
  buildCampRegistrationShareEmail,
  buildCampRegistrationShareEmailHtml,
} from '../../constants/camperRegistrationForm';
import { participantAgeInMonths } from '../../utils/bookingTicketAssignment';

const VALID_STATUS = 'valid';
const EXPIRED_STATUS = 'expired';
const MISSING_STATUS = 'missing';
const NOT_REQUIRED_STATUS = 'not_required';
const ADULT_MIN_MONTHS = 18 * 12;

function normalizeDateOnly(value) {
  if (!value) return '';
  return String(value).split('T')[0];
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function isExpired(expiresAt, asOfDate = null) {
  if (!expiresAt) return false;
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) return false;
  // Valid if expires strictly after the as-of date (camp day end) or "now".
  if (asOfDate) {
    const asOf = new Date(`${normalizeDateOnly(asOfDate)}T23:59:59.999`);
    if (Number.isNaN(asOf.getTime())) return expires <= new Date();
    return expires.getTime() <= asOf.getTime();
  }
  return expires.getTime() <= Date.now();
}

function participantIdentityKey(participant) {
  return [
    normalizeText(participant?.first_name ?? participant?.firstName),
    normalizeText(participant?.last_name ?? participant?.lastName),
    normalizeDateOnly(participant?.date_of_birth ?? participant?.dateOfBirth),
  ].join('|');
}

function documentStatus(document, asOfDate = null) {
  if (!document) return MISSING_STATUS;
  if (document.is_valid === false) return EXPIRED_STATUS;
  if (isExpired(document.expires_at, asOfDate)) return EXPIRED_STATUS;
  return VALID_STATUS;
}

function escapeIlikePattern(needle) {
  if (needle == null) return '';
  return String(needle)
    .replace(/\\/g, '\\\\')
    .replace(/[%_]/g, (ch) => `\\${ch}`);
}

class CamperRegistrationService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  activityRequiresRegistration(activity, bookingType = null) {
    return Boolean(
      activity?.requires_camper_registration ||
      bookingType?.requires_camper_registration ||
      activity?.ticket_settings?.requires_camper_registration
    );
  }

  /**
   * Annual camp registration applies to minors (campers) only — never parents/account owners.
   */
  participantRequiresCamperRegistration(participant, activityRequiresRegistration = true) {
    if (!activityRequiresRegistration || !participant) return false;

    if (participant.is_account_owner === true) return false;
    if (participant.is_minor === false) return false;

    const type = String(participant.participant_type || participant.type || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');

    if (type === 'primary') return false;
    if (participant.is_account_owner === true) return false;

    if (type === 'minor' || participant.is_minor === true) return true;

    const dob =
      participant.date_of_birth ??
      participant.dateOfBirth ??
      participant.booking_customer_participants?.date_of_birth ??
      null;
    const ageMonths = participantAgeInMonths(dob);
    if (ageMonths != null) {
      return ageMonths < ADULT_MIN_MONTHS;
    }

    // Adult chaperone / additional adult without child DOB — no camper form
    if (type === 'additional_adult' || type === 'additionaladult') return false;

    return false;
  }

  getParticipantStatus(participant, required = true, asOfDate = null) {
    if (!this.participantRequiresCamperRegistration(participant, required)) {
      return NOT_REQUIRED_STATUS;
    }
    if (participant?.camper_registration_status === NOT_REQUIRED_STATUS) {
      return NOT_REQUIRED_STATUS;
    }
    // Prefer live document expiry vs camp date when available.
    if (participant?.camper_registration_document) {
      return documentStatus(participant.camper_registration_document, asOfDate);
    }
    if (participant?.camper_registration_status) return participant.camper_registration_status;
    return documentStatus(participant?.camper_registration_document, asOfDate);
  }

  async getFormTemplate(businessIdOverride = null) {
    const businessId = businessIdOverride || this.businessId;
    if (!businessId) return mergeCamperRegistrationTemplate(null);

    const { data, error } = await supabase.rpc('bookings_get_portal_camper_registration_template', {
      p_business_id: businessId,
    });

    if (error) {
      const { data: directRow, error: directError } = await supabase
        .from('camper_registration_form_templates')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .maybeSingle();

      if (directError) {
        console.warn('[CamperRegistrationService] Could not load form template:', error, directError);
        return mergeCamperRegistrationTemplate(null);
      }
      return mergeCamperRegistrationTemplate(directRow);
    }

    const row = Array.isArray(data) ? data[0] : data;
    return mergeCamperRegistrationTemplate(row);
  }

  async getDocumentById(documentId) {
    if (!documentId) throw new Error('Document ID is required');
    const { data, error } = await supabase
      .from('camper_registration_documents')
      .select('*')
      .eq('id', documentId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Registration document not found');
    return data;
  }

  async getRecentDocuments(limit = 25, searchQuery = '') {
    if (!this.businessId) return [];
    let query = supabase
      .from('camper_registration_documents')
      .select(
        'id, first_name, last_name, signed_at, expires_at, is_valid, source, customer_id, imported_file_url, staff_print_reviewed, staff_print_reviewed_at, staff_print_reviewed_by'
      )
      .eq('business_id', this.businessId)
      .order('signed_at', { ascending: false })
      .limit(limit);

    const term = String(searchQuery || '').trim();
    if (term) {
      const tokens = term.split(/\s+/).filter(Boolean).map(escapeIlikePattern);
      if (tokens.length >= 2) {
        // Full name: first_name + last_name are stored separately (e.g. "Elijah" / "Leader").
        query = query
          .ilike('first_name', `%${tokens[0]}%`)
          .ilike('last_name', `%${tokens[tokens.length - 1]}%`);
      } else {
        const t = tokens[0];
        query = query.or(`first_name.ilike.%${t}%,last_name.ilike.%${t}%`);
      }
    }

    const { data, error } = await query;
    if (error) {
      console.warn('[CamperRegistrationService] Could not load recent documents:', error);
      return [];
    }
    return data || [];
  }

  async setStaffPrintReviewed(documentId, reviewed) {
    if (!this.businessId) throw new Error('Business ID is required');
    if (!documentId) throw new Error('Document ID is required');

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const payload = reviewed
      ? {
          staff_print_reviewed: true,
          staff_print_reviewed_at: new Date().toISOString(),
          staff_print_reviewed_by: user?.id || null,
          updated_at: new Date().toISOString(),
        }
      : {
          staff_print_reviewed: false,
          staff_print_reviewed_at: null,
          staff_print_reviewed_by: null,
          updated_at: new Date().toISOString(),
        };

    const { data, error } = await supabase
      .from('camper_registration_documents')
      .update(payload)
      .eq('id', documentId)
      .eq('business_id', this.businessId)
      .select('id, staff_print_reviewed, staff_print_reviewed_at, staff_print_reviewed_by')
      .single();

    if (error) throw error;
    return data;
  }

  async deleteDocument(documentId) {
    if (!this.businessId) throw new Error('Business ID is required');
    if (!documentId) throw new Error('Document ID is required');

    const { error: detachError } = await supabase
      .from('booking_participants')
      .update({ camper_registration_status: 'missing' })
      .eq('camper_registration_document_id', documentId);

    if (detachError) {
      console.warn('[CamperRegistrationService] Could not detach booking participants before delete:', detachError);
    }

    let storagePath = null;
    try {
      const existing = await this.getDocumentById(documentId);
      storagePath = this.parseImportedStoragePath(existing?.imported_file_url);
    } catch {
      // continue with delete even if lookup fails
    }

    const { data, error } = await supabase
      .from('camper_registration_documents')
      .delete()
      .eq('id', documentId)
      .eq('business_id', this.businessId)
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error('Registration form not found or could not be deleted.');

    if (storagePath) {
      try {
        await supabase.storage.from('waivers').remove([storagePath]);
      } catch (storageError) {
        console.warn('[CamperRegistrationService] Could not remove imported file from storage:', storageError);
      }
    }

    return data;
  }

  parseImportedStoragePath(importedFileUrl) {
    if (!importedFileUrl || typeof importedFileUrl !== 'string') return null;
    const trimmed = importedFileUrl.trim();
    if (trimmed.startsWith('waivers://')) return trimmed.slice('waivers://'.length);
    if (trimmed.startsWith('paper-waivers/') || trimmed.startsWith('camper-registrations/')) return trimmed;
    return null;
  }

  async getImportedFileSignedUrl(importedFileUrl, expiresIn = 3600) {
    const filePath = this.parseImportedStoragePath(importedFileUrl);
    if (!filePath) {
      if (typeof importedFileUrl === 'string' && (importedFileUrl.startsWith('http://') || importedFileUrl.startsWith('https://'))) {
        return importedFileUrl;
      }
      return null;
    }

    const { data, error } = await supabase.storage.from('waivers').createSignedUrl(filePath, expiresIn);
    if (error) throw error;
    return data?.signedUrl || null;
  }

  /**
   * Upload a scanned/photographed paper registration and create a digital document record.
   * Optional ocrResult from camper-registration-extract fills structured form_data like an online submission.
   * @param {File} file
   * @param {{ firstName?: string, lastName?: string, dateOfBirth?: string, signedAt?: string, signedByName?: string, signedByRelationship?: string, expiryDays?: number, notes?: string }} meta
   * @param {object|null} ocrResult
   */
  async importPaperRegistration(file, meta = {}, ocrResult = null) {
    if (!this.businessId) throw new Error('Business ID is required');
    if (!file) throw new Error('A scanned form file is required');

    const ocr = ocrResult && typeof ocrResult === 'object' ? ocrResult : null;
    const firstName = String(meta.firstName || ocr?.first_name || '').trim();
    const lastName = String(meta.lastName || ocr?.last_name || '').trim();
    const signedByName = String(meta.signedByName || ocr?.signed_by_name || '').trim();
    if (!firstName || !lastName) throw new Error('Camper first and last name are required');
    if (!signedByName) throw new Error('Signed-by (parent/guardian) name is required');

    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (file.type && !allowedTypes.includes(file.type) && !/\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(file.name || '')) {
      throw new Error('Upload a PDF or image of the completed form (PDF, JPG, PNG).');
    }

    const safeName = String(file.name || 'paper-form.pdf')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 120);
    const filePath = `paper-waivers/${this.businessId}/camper-registration-${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage.from('waivers').upload(filePath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const template = await this.getFormTemplate(this.businessId);
    const expiryDays = Math.max(Number(meta.expiryDays) || Number(template?.expiry_days) || 365, 1);
    const signedAtRaw = meta.signedAt || ocr?.signed_at || null;
    const signedAt = signedAtRaw
      ? new Date(`${String(signedAtRaw).split('T')[0]}T12:00:00`)
      : new Date();
    if (Number.isNaN(signedAt.getTime())) throw new Error('Invalid signed date');
    const expiresAt = new Date(signedAt.getTime() + expiryDays * 24 * 60 * 60 * 1000);

    const dateOfBirthRaw = meta.dateOfBirth || ocr?.date_of_birth || null;
    const dateOfBirth = dateOfBirthRaw ? String(dateOfBirthRaw).split('T')[0] : null;
    const placeholderUrl = `waivers://${filePath}`;

    const ocrFormData = ocr?.form_data && typeof ocr.form_data === 'object' ? ocr.form_data : null;
    const formData = ocrFormData
      ? {
          ...ocrFormData,
          source_note: 'Imported from paper form scan (OCR digitized)',
          original_filename: file.name || null,
          staff_notes: meta.notes ? String(meta.notes).trim() : null,
          signed_at: signedAt.toISOString(),
          ocr: {
            ...(ocrFormData.ocr && typeof ocrFormData.ocr === 'object' ? ocrFormData.ocr : {}),
            digitized: true,
            confidence: ocr?.confidence ?? ocrFormData.ocr?.confidence ?? null,
            warnings: Array.isArray(ocr?.warnings) ? ocr.warnings : ocrFormData.ocr?.warnings || [],
            extracted_at: new Date().toISOString(),
          },
        }
      : {
          source_note: 'Imported from paper form scan',
          original_filename: file.name || null,
          staff_notes: meta.notes ? String(meta.notes).trim() : null,
        };

    const authorizedPickups = Array.isArray(ocr?.authorized_pickups) ? ocr.authorized_pickups : [];
    const medicalSummary =
      ocr?.medical_summary && typeof ocr.medical_summary === 'object'
        ? ocr.medical_summary
        : {
            medical_needs: formData.medical_needs || '',
            allergies: formData.allergies || [],
            medications: formData.medications || [],
            has_alerts: false,
          };

    const payload = {
      business_id: this.businessId,
      first_name: firstName,
      last_name: lastName,
      date_of_birth: dateOfBirth || null,
      form_data: formData,
      authorized_pickups: authorizedPickups,
      medical_summary: medicalSummary,
      signature_image_url: null,
      signature_data: null,
      signed_by_name: signedByName,
      signed_by_relationship:
        meta.signedByRelationship
          ? String(meta.signedByRelationship).trim()
          : ocr?.signed_by_relationship
            ? String(ocr.signed_by_relationship).trim()
            : null,
      signed_at: signedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      is_valid: true,
      source: 'import',
      imported_file_url: placeholderUrl,
      created_by: user?.id || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Supersede prior valid docs for the same camper (name + DOB) when DOB is known.
    // Without DOB, skip auto-invalidation to avoid wiping unrelated same-name campers.
    if (dateOfBirth) {
      const { error: supersedeError } = await supabase
        .from('camper_registration_documents')
        .update({ is_valid: false, updated_at: new Date().toISOString() })
        .eq('business_id', this.businessId)
        .eq('is_valid', true)
        .ilike('first_name', firstName)
        .ilike('last_name', lastName)
        .eq('date_of_birth', dateOfBirth);
      if (supersedeError) throw supersedeError;
    }

    const { data, error } = await supabase
      .from('camper_registration_documents')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      try {
        await supabase.storage.from('waivers').remove([filePath]);
      } catch {
        // ignore cleanup failure
      }
      throw error;
    }

    return data;
  }

  async saveFormTemplate(templatePayload) {
    if (!this.businessId) throw new Error('Business ID is required');

    const payload = {
      business_id: this.businessId,
      form_title: templatePayload.form_title || DEFAULT_CAMPER_REGISTRATION_TEMPLATE.form_title,
      form_intro: templatePayload.form_intro ?? DEFAULT_CAMPER_REGISTRATION_TEMPLATE.form_intro,
      expiry_days: Number(templatePayload.expiry_days) || 365,
      fields_config: templatePayload.fields_config || DEFAULT_CAMPER_REGISTRATION_TEMPLATE.fields_config,
      is_active: templatePayload.is_active !== false,
      updated_at: new Date().toISOString(),
    };

    const { data: existing, error: existingError } = await supabase
      .from('camper_registration_form_templates')
      .select('id')
      .eq('business_id', this.businessId)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing?.id) {
      const { data, error } = await supabase
        .from('camper_registration_form_templates')
        .update(payload)
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error) throw error;
      return mergeCamperRegistrationTemplate(data);
    }

    const { data, error } = await supabase
      .from('camper_registration_form_templates')
      .insert({ ...payload, created_at: new Date().toISOString() })
      .select('*')
      .single();
    if (error) throw error;
    return mergeCamperRegistrationTemplate(data);
  }

  async getCustomerRegistrations(customerId) {
    if (!this.businessId || !customerId) return [];

    const { data, error } = await supabase.rpc('bookings_get_portal_camper_registrations', {
      p_business_id: this.businessId,
      p_customer_id: customerId,
    });

    if (error) {
      console.warn('[CamperRegistrationService] Could not load camper registrations:', error);
      return [];
    }

    return Array.isArray(data) ? data : [];
  }

  async getRegistrationPrefill(customerId, participant) {
    if (!this.businessId || !customerId || !participant) return null;

    const { data, error } = await supabase.rpc('bookings_get_portal_camper_registration_prefill', {
      p_business_id: this.businessId,
      p_customer_id: customerId,
      p_participant_id: participant.id || null,
      p_booking_customer_participant_id: participant.booking_customer_participant_id || null,
      p_first_name: participant.first_name || participant.firstName || null,
      p_last_name: participant.last_name || participant.lastName || null,
      p_date_of_birth: participant.date_of_birth || participant.dateOfBirth || null,
    });

    if (error) {
      console.warn('[CamperRegistrationService] Could not load registration prefill:', error);
      return null;
    }

    if (!data || typeof data !== 'object') return null;
    return data;
  }

  findCurrentRegistrationForParticipant(participant, registrations = [], asOfDate = null) {
    if (!participant) return null;

    const direct = registrations.find((doc) => {
      return (
        (participant.id && doc.participant_id && String(doc.participant_id) === String(participant.id)) ||
        (participant.booking_customer_participant_id &&
          doc.booking_customer_participant_id &&
          String(doc.booking_customer_participant_id) === String(participant.booking_customer_participant_id))
      );
    });

    const identityKey = participantIdentityKey(participant);
    const identity = registrations.find((doc) => participantIdentityKey(doc) === identityKey);

    const candidates = [direct, identity].filter(Boolean);
    if (!candidates.length) return null;

    candidates.sort((a, b) => {
      const aValid = documentStatus(a, asOfDate) === VALID_STATUS ? 1 : 0;
      const bValid = documentStatus(b, asOfDate) === VALID_STATUS ? 1 : 0;
      if (aValid !== bValid) return bValid - aValid;
      return new Date(b.expires_at || b.signed_at || 0).getTime() - new Date(a.expires_at || a.signed_at || 0).getTime();
    });

    return candidates[0];
  }

  enrichParticipants(participants = [], registrations = [], required = true, asOfDate = null) {
    const list = Array.isArray(participants) ? participants : [];
    return list.map((participant) => {
      if (!this.participantRequiresCamperRegistration(participant, required)) {
        return {
          ...participant,
          camper_registration_document_id: null,
          camper_registration_status: NOT_REQUIRED_STATUS,
          camper_registration_document: null,
        };
      }

      const document = this.findCurrentRegistrationForParticipant(participant, registrations, asOfDate);
      const status = documentStatus(document, asOfDate);
      return {
        ...participant,
        camper_registration_document_id: status === VALID_STATUS ? document?.id || null : null,
        camper_registration_status: status,
        camper_registration_document: document || null,
      };
    });
  }

  async submitRegistration({
    customerId,
    participant,
    formData,
    authorizedPickups,
    medicalSummary,
    signatureImageUrl,
    signatureData,
    signedByName,
    signedByRelationship,
    expiryDays,
  }) {
    if (!this.businessId) throw new Error('Business ID is required');
    if (!customerId) throw new Error('Customer ID is required');
    if (!participant) throw new Error('Participant is required');
    if (!this.participantRequiresCamperRegistration(participant, true)) {
      throw new Error('Camp registration is only required for minor campers, not parents or adult chaperones.');
    }

    const { data, error } = await supabase.rpc('bookings_submit_portal_camper_registration', {
      p_business_id: this.businessId,
      p_customer_id: customerId,
      p_participant_id: participant.id || null,
      p_booking_customer_participant_id: participant.booking_customer_participant_id || null,
      p_first_name: participant.first_name || participant.firstName || '',
      p_last_name: participant.last_name || participant.lastName || '',
      p_date_of_birth: participant.date_of_birth || participant.dateOfBirth || null,
      p_form_data: formData || {},
      p_authorized_pickups: authorizedPickups || [],
      p_medical_summary: medicalSummary || {},
      p_signature_image_url: signatureImageUrl || null,
      p_signature_data: signatureData || null,
      p_signed_by_name: signedByName || '',
      p_signed_by_relationship: signedByRelationship || null,
      p_expiry_days: expiryDays || 365,
    });

    if (error) throw error;
    return data;
  }

  async sendPortalLinkEmail({ recipientEmail, recipientName = null }) {
    if (!this.businessId) throw new Error('Business ID is required');

    const email = String(recipientEmail || '').trim();
    if (!email) throw new Error('Recipient email is required');

    const [template, businessResult, mailSettingsResult] = await Promise.all([
      this.getFormTemplate(),
      supabase.from('businesses').select('name, business_email').eq('id', this.businessId).maybeSingle(),
      supabase.from('mail_settings').select('from_email, from_name').eq('business_id', this.businessId).maybeSingle(),
    ]);

    if (businessResult.error) throw businessResult.error;
    if (mailSettingsResult.error) throw mailSettingsResult.error;

    const businessName = businessResult.data?.name || '';
    const shareEmail = buildCampRegistrationShareEmail({
      businessName,
      businessId: this.businessId,
      formTitle: template.form_title,
      recipientName,
    });

    const html = buildCampRegistrationShareEmailHtml({
      businessName: shareEmail.businessName,
      formTitle: shareEmail.formTitle,
      introText: shareEmail.introText,
      portalUrl: shareEmail.portalUrl,
    });

    const textBody = [
      shareEmail.introText,
      '',
      'Complete registration form:',
      shareEmail.portalUrl,
      '',
      `Sent by ${shareEmail.businessName} through Tavari.`,
    ].join('\n');

    const mailSettings = mailSettingsResult.data;
    const fromEmail =
      mailSettings?.from_email?.trim() ||
      businessResult.data?.business_email?.trim() ||
      import.meta.env.VITE_FALLBACK_FROM_EMAIL?.trim() ||
      '';

    if (!fromEmail) {
      throw new Error('No sender email configured. Set up mail settings or a business email first.');
    }

    const fromName = businessName ? `${businessName} - Registration` : mailSettings?.from_name || 'Your Business';

    const payload = {
      businessId: this.businessId,
      campaignId: `camp-reg-link-${Date.now()}`,
      contactId: `camp-reg-${email}`,
      emailType: 'transactional',
      to: email,
      fromEmail,
      fromName,
      subject: shareEmail.subject,
      html,
      text: textBody,
    };

    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(errorBody || `Send failed (${response.status})`);
    }

    const data = await response.json().catch(() => null);
    if (!data?.ok) throw new Error(data?.error || 'Send failed');

    return data;
  }
}

export const camperRegistrationStatuses = {
  VALID_STATUS,
  EXPIRED_STATUS,
  MISSING_STATUS,
  NOT_REQUIRED_STATUS,
};

export default new CamperRegistrationService();
