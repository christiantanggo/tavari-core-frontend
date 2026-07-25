// src/services/Waivers/WaiverSubmissionService.js
// Service for submitting complete waivers with all participants, signatures, and location data

import { supabase } from '../../supabaseClient';
import { saveSignatureImage } from '../../utils/waiverSignatureCapture';
import { getIPAddress } from '../../utils/waiverLocationTracking';
import { waiverOTPService } from './WaiverOTPService';
import { buildWaiverConsentInsertRows } from '../../constants/waiverConsentTypes';
import WaiverMailIntegration from './WaiverMailIntegration';
import { invokeWaiverArchive, FINALIZE_FN } from './waiverArchiveInvoke';
import {
  DEFAULT_ADDITIONAL_ADULT_PORTAL_ACCESS,
  WAIVER_PORTAL_ACCESS
} from '../../constants/waiverParticipantPortalAccess';

const CORE_SUBMIT_FN = 'waiver-submit-core';

class WaiverSubmissionService {
  getCustomerFacingSubmissionMessage(error) {
    const genericMessage = 'We could not complete your waiver. Please try again.';
    const message = typeof error?.message === 'string' ? error.message.trim() : '';
    if (!message) return genericMessage;

    const normalized = message.toLowerCase();
    const safeMessages = [
      'please try again',
      'please review the form',
      'please complete all required waiver steps'
    ];

    if (safeMessages.some((phrase) => normalized.includes(phrase))) {
      return message;
    }

    return genericMessage;
  }

  async rollbackPendingWaiver(waiverId) {
    if (!waiverId) return;

    try {
      const { error: participantsDeleteError } = await supabase
        .from('waiver_participants')
        .delete()
        .eq('waiver_id', waiverId);

      if (participantsDeleteError) {
        console.warn('[WaiverSubmissionService] Rollback warning deleting participants:', participantsDeleteError);
      }
    } catch (error) {
      console.warn('[WaiverSubmissionService] Rollback warning deleting participants:', error);
    }

    try {
      const { error: consentsDeleteError } = await supabase
        .from('waiver_consents')
        .delete()
        .eq('waiver_id', waiverId);

      if (consentsDeleteError) {
        console.warn('[WaiverSubmissionService] Rollback warning deleting consents:', consentsDeleteError);
      }
    } catch (error) {
      console.warn('[WaiverSubmissionService] Rollback warning deleting consents:', error);
    }

    try {
      const { error: signatureDeleteError } = await supabase
        .from('waiver_signatures')
        .delete()
        .eq('id', waiverId);

      if (signatureDeleteError) {
        console.warn('[WaiverSubmissionService] Rollback warning deleting waiver signature:', signatureDeleteError);
      }
    } catch (error) {
      console.warn('[WaiverSubmissionService] Rollback warning deleting waiver signature:', error);
    }
  }

  buildAdditionalAdultSignerAcknowledgments(participants = []) {
    return (Array.isArray(participants) ? participants : [])
      .filter((participant) => participant?.type === 'additional_adult')
      .map((participant) => ({
        kind: 'adult_signer_ack',
        participant_name: `${participant?.data?.firstName || ''} ${participant?.data?.lastName || ''}`.replace(/\s+/g, ' ').trim() || 'Additional adult',
        participant_portal_access:
          participant?.portalAccess ||
          participant?.data?.portalAccess ||
          DEFAULT_ADDITIONAL_ADULT_PORTAL_ACCESS,
        waiver_terms_accepted: !!participant?.consentStates?.waiverTerms,
        electronic_signature_accepted:
          !!participant?.consentStates?.electronicSignature || !!participant?.signed,
        marketing_accepted: !!participant?.consentStates?.marketing,
        signed_by_self_confirmed:
          participant?.consentStates?.selfSignerConfirmed == null
            ? !!participant?.signed
            : !!participant?.consentStates?.selfSignerConfirmed,
        acknowledged_at: participant?.signed ? new Date().toISOString() : null
      }));
  }

  async insertWaiverSignatureWithCompatibility(payload) {
    const initialResult = await supabase
      .from('waiver_signatures')
      .insert(payload)
      .select('id')
      .single();

    const initialMessage = initialResult?.error?.message ? String(initialResult.error.message) : '';
    if (!initialResult.error || initialMessage.indexOf('additional_adult_intent_acknowledgments') === -1) {
      return {
        ...initialResult,
        usedCompatibilityFallback: false
      };
    }

    const fallbackPayload = { ...payload };
    delete fallbackPayload.additional_adult_intent_acknowledgments;

    const fallbackResult = await supabase
      .from('waiver_signatures')
      .insert(fallbackPayload)
      .select('id')
      .single();

    return {
      ...fallbackResult,
      usedCompatibilityFallback: !fallbackResult.error
    };
  }

  async archiveAndEmailWaiver({
    waiverId,
    businessId,
    signatureToken,
    recipientEmail = null,
    sendEmail = true
  }) {
    return invokeWaiverArchive(
      {
        waiverId,
        businessId,
        signatureToken,
        recipientEmail: recipientEmail || undefined,
        sendEmail
      },
      { functionName: FINALIZE_FN }
    );
  }

  async submitWaiverCore({ waiverSignature, participants, consents }) {
    const { data, error } = await supabase.functions.invoke(CORE_SUBMIT_FN, {
      body: { waiverSignature, participants, consents }
    });

    if (error || data?.success !== true) {
      throw new Error(data?.error || error?.message || 'Core waiver save failed');
    }

    return data;
  }

  /**
   * Submit complete waiver with all participants
   * @param {object} waiverData - Complete waiver data
   * @returns {Promise<{success: boolean, waiverId?: string}>}
   */
  async submitWaiver(waiverData) {
    let createdWaiverId = null;

    try {
      const {
        businessId,
        templateId,
        customerInfo,
        participants,
        locationData,
        signerParticipant, // optional: use this participant as signer (e.g. guardian signing for minors)
        additionalAdultIntentAcknowledgments = [],
        consentStates = {}
      } = waiverData;
      
      const ipForRecord =
        locationData?.ip ||
        (typeof fetch !== 'undefined' ? await getIPAddress().catch(() => null) : null);

      // Signer: who is signing this waiver (must have signatureData). Can be primary, an additional adult, or guardian for minors.
      const signer = signerParticipant || participants.find(p => p.signatureData) || participants.find(p => p.type === 'primary');
      if (!signer) {
        throw new Error('A signer is required (participant with signature or primary)');
      }
      if (!signer.signatureData) {
        throw new Error('Signer must provide a signature');
      }

      const effectiveConsentStates = {
        ...(consentStates && typeof consentStates === 'object' ? consentStates : {})
      };

      // Additional waiver paths can store the signer's marketing choice on the participant instead
      // of the top-level waiver consent state. Preserve it so mail sync does not default them
      // to unsubscribed when they explicitly opted in during signing.
      if (
        typeof effectiveConsentStates.marketing !== 'boolean' &&
        typeof signer?.consentStates?.marketing === 'boolean'
      ) {
        effectiveConsentStates.marketing = signer.consentStates.marketing;
      }

      // Create or get customer account (one database, multiple doors)
      let customerId = customerInfo?.customerId || customerInfo?.id || customerInfo?.customer_id || null;
      if (!customerId && signer.data) {
        const customerResult = await waiverOTPService.createOrGetCustomer(
          businessId,
          customerInfo?.phoneNumber || signer.data.phoneNumber,
          customerInfo?.email || signer.data.email,
          signer.data.firstName,
          signer.data.lastName
        );
        customerId = customerResult?.customerId || customerResult?.customer_id || null;
      }

      if (!customerId) {
        throw new Error('Unable to create or link a customer account for this waiver');
      }

      // Generate signature token
      const { data: signatureToken, error: tokenError } = await supabase.rpc(
        'waivers_create_signature_token',
        { business_uuid: businessId }
      );

      if (tokenError) throw tokenError;

      const waiverId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Save signer's signature to storage
      let primarySignatureUrl = null;
      if (signer.signatureData) {
        try {
          const signatureResult = await saveSignatureImage(
            signer.signatureData,
            businessId,
            waiverId
          );
          primarySignatureUrl = signatureResult.publicUrl;
        } catch (error) {
          console.error('[WaiverSubmissionService] Error saving signer signature:', error);
        }
      }

      // Calculate expiry date - check settings first, then template
      // CRITICAL: Expiry must be calculated from signed_at, not Date.now()
      let expiryDays = null;
      
      console.log('[WaiverSubmissionService] ========== EXPIRY CALCULATION START ==========');
      console.log('[WaiverSubmissionService] Business ID:', businessId);
      console.log('[WaiverSubmissionService] Template ID:', templateId);
      
      // Check global waiver settings for default_expiry_days
      const { data: globalSettings, error: settingsError } = await supabase
        .from('waiver_settings')
        .select('setting_value, setting_key, is_global')
        .eq('business_id', businessId)
        .eq('setting_key', 'default_expiry_days')
        .eq('is_global', true)
        .maybeSingle();
      
      console.log('[WaiverSubmissionService] Global settings query:', {
        data: globalSettings,
        error: settingsError,
        settingValue: globalSettings?.setting_value,
        settingValueType: typeof globalSettings?.setting_value
      });
      
      if (globalSettings?.setting_value !== null && globalSettings?.setting_value !== undefined) {
        expiryDays = typeof globalSettings.setting_value === 'number' 
          ? globalSettings.setting_value 
          : parseInt(globalSettings.setting_value);
        console.log('[WaiverSubmissionService] Found global expiry days:', expiryDays);
      }
      
      // If no global setting, check template
      if (!expiryDays || isNaN(expiryDays)) {
        console.log('[WaiverSubmissionService] No global setting, checking template...');
        const { data: template, error: templateError } = await supabase
          .from('waiver_templates')
          .select('expiry_days, template_name')
          .eq('id', templateId)
          .maybeSingle();
        
        console.log('[WaiverSubmissionService] Template query:', {
          data: template,
          error: templateError,
          templateName: template?.template_name,
          expiryDays: template?.expiry_days
        });
        
        if (template?.expiry_days !== null && template?.expiry_days !== undefined) {
          expiryDays = typeof template.expiry_days === 'number' 
            ? template.expiry_days 
            : parseInt(template.expiry_days);
          console.log('[WaiverSubmissionService] Found template expiry days:', expiryDays);
        }
      }

      // CRITICAL FIX: Calculate expiry from signed_at time, not Date.now()
      // Use a single timestamp for both signed_at and expiry calculation to ensure consistency
      const signedAtTimestamp = new Date();
      const signedAt = signedAtTimestamp.toISOString();
      
      console.log('[WaiverSubmissionService] Expiry calculation:', {
        expiryDays,
        signedAt,
        signedAtTimestamp: signedAtTimestamp.toISOString(),
        expiryDaysType: typeof expiryDays,
        isNaN: isNaN(expiryDays)
      });

      let expiresAt = null;
      if (expiryDays && !isNaN(expiryDays) && expiryDays > 0) {
        // Calculate expiry: signed_at + expiryDays
        const expiryDate = new Date(signedAtTimestamp.getTime() + expiryDays * 24 * 60 * 60 * 1000);
        expiresAt = expiryDate.toISOString();
        console.log('[WaiverSubmissionService] ✅ Calculated expiry:', {
          expiresAt,
          expiryDate: expiryDate.toISOString(),
          daysFromNow: Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24)),
          expiryDays,
          signedAt
        });
      } else {
        console.warn('[WaiverSubmissionService] ⚠️ No expiry days found - waiver will not expire');
        console.warn('[WaiverSubmissionService] Settings check:', { 
          globalSettings, 
          expiryDays,
          hasGlobalSettings: !!globalSettings,
          settingValue: globalSettings?.setting_value
        });
      }
      
      console.log('[WaiverSubmissionService] Final values for insert:', {
        signed_at: signedAt,
        expires_at: expiresAt,
        hasExpiresAt: !!expiresAt
      });
      console.log('[WaiverSubmissionService] ========== EXPIRY CALCULATION END ==========');

      // Log signer data before insert
      console.log('[WaiverSubmissionService] Signer data:', {
        type: signer.type,
        firstName: signer.data?.firstName,
        lastName: signer.data?.lastName,
        phoneNumber: signer.data?.phoneNumber,
        email: signer.data?.email,
        allDataKeys: Object.keys(signer.data || {})
      });

      const acksJson = [
        ...(Array.isArray(additionalAdultIntentAcknowledgments)
          ? additionalAdultIntentAcknowledgments
          : []),
        ...this.buildAdditionalAdultSignerAcknowledgments(participants)
      ];

      // Create waiver signature record (one per signer)
      const signatureInsertPayload = {
        id: waiverId,
        client_submission_id: waiverId,
        business_id: businessId,
        template_id: templateId,
        signature_token: signatureToken,
        first_name: signer.data?.firstName ?? '',
        last_name: signer.data?.lastName ?? '',
        date_of_birth: signer.data?.dateOfBirth ?? null,
        phone_number: (() => {
          const d = (signer.data?.phoneNumber && String(signer.data.phoneNumber).replace(/\D/g, '')) || '';
          return d.length >= 10 ? d : null;
        })(),
        email: signer.data?.email ?? null,
        address: signer.data?.address ?? null,
        city: signer.data?.city ?? null,
        postal_code: signer.data?.postalCode ?? null,
        signature_image_url: primarySignatureUrl,
        signature_data: signer.signatureData,
        customer_id: customerId,
        is_minor: false,
        is_valid: true,
        signed_at: signedAt,
        expires_at: expiresAt,
        ip_address: ipForRecord || null,
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        location_source: locationData?.source || null,
        location_latitude: locationData?.latitude ?? null,
        location_longitude: locationData?.longitude ?? null,
        location_address: locationData?.address || null,
        location_city: locationData?.city || null,
        location_state: locationData?.state || null,
        location_postal_code: locationData?.postal_code || null,
        location_country: locationData?.country || null,
        additional_adult_intent_acknowledgments: acksJson
      };

      console.log('[WaiverSubmissionService] Waiver signature prepared:', {
        waiverId,
        signerType: signer.type,
        phoneNumber: signer.data?.phoneNumber,
        phoneNumberIncluded: !!signer.data?.phoneNumber
      });

      // Persist consent + flow acknowledgements (terms, e-signature, additional-adult intent, marketing, etc.)
      // Create participant records
      const participantRecords = [];
      console.log('[WaiverSubmissionService] Creating participant records for', participants.length, 'participants');
      console.log('[WaiverSubmissionService] Participants array:', participants.map(p => ({
        type: p.type,
        hasData: !!p.data,
        hasSignature: !!p.signatureData,
        signed: p.signed,
        name: p.data ? `${p.data.firstName} ${p.data.lastName}` : 'No data'
      })));
      
      for (const participant of participants) {
        // Skip if participant doesn't have data (shouldn't happen, but safety check)
        if (!participant.data || (!participant.data.firstName && !participant.data.lastName)) {
          console.warn('[WaiverSubmissionService] Skipping participant with no data:', participant);
          continue;
        }
        let participantSignatureUrl = null;

        // Save signature if exists
        if (participant.signatureData) {
          try {
            const sigResult = await saveSignatureImage(
              participant.signatureData,
              businessId,
              waiverId
            );
            participantSignatureUrl = sigResult.publicUrl;
          } catch (error) {
            console.error('[WaiverSubmissionService] Error saving participant signature:', error);
          }
        }

        const portalRaw =
          participant.type === 'additional_adult'
            ? participant.portalAccess ||
              participant.data?.portalAccess ||
              DEFAULT_ADDITIONAL_ADULT_PORTAL_ACCESS
            : null;
        const portalAllowed = new Set(Object.values(WAIVER_PORTAL_ACCESS));
        const participant_portal_access =
          participant.type === 'additional_adult' && portalAllowed.has(portalRaw)
            ? portalRaw
            : participant.type === 'additional_adult'
              ? DEFAULT_ADDITIONAL_ADULT_PORTAL_ACCESS
              : null;

        const participantRecord = {
          waiver_id: waiverId,
          customer_id: customerId || null,
          business_id: businessId,
          participant_type: participant.type,
          first_name: participant.data?.firstName || '',
          last_name: participant.data?.lastName || '',
          date_of_birth: participant.data?.dateOfBirth || null,
          phone_number: (() => {
            const d =
              (participant.data?.phoneNumber &&
                String(participant.data.phoneNumber).replace(/\D/g, '')) ||
              '';
            return d.length >= 10 ? d : null;
          })(),
          email: participant.data?.email || null,
          address: participant.data?.address || null,
          city: participant.data?.city || null,
          postal_code: participant.data?.postalCode || null,
          signature_image_url: participantSignatureUrl,
          signature_data: participant.signatureData || null,
          signed_at: participant.signed ? new Date().toISOString() : null,
          is_required: participant.type === 'primary',
          is_account_owner: participant.type === 'primary',
          ...(participant.type === 'additional_adult'
            ? { participant_portal_access }
            : {})
        };
        
        console.log('[WaiverSubmissionService] Creating participant record:', {
          type: participant.type,
          name: `${participantRecord.first_name} ${participantRecord.last_name}`,
          signed: participant.signed,
          waiver_id: participantRecord.waiver_id
        });
        
        participantRecords.push(participantRecord);
      }

      if (participantRecords.length === 0) {
        console.error('[WaiverSubmissionService] No participant records were built for submission');
        throw new Error('Unable to save waiver participants. Please review the form and try again.');
      }

      const consentRows = buildWaiverConsentInsertRows(waiverId, effectiveConsentStates, {
        additionalAdultIntentAcknowledgments: acksJson,
        acknowledgedAt: signedAt
      });
      if (consentRows.length === 0) {
        console.error('[WaiverSubmissionService] No consent audit rows were built for submission');
        throw new Error('We could not complete your waiver. Please try again.');
      }

      const coreResult = await this.submitWaiverCore({
        waiverSignature: signatureInsertPayload,
        participants: participantRecords,
        consents: consentRows
      });
      createdWaiverId = waiverId;
      console.log('[WaiverSubmissionService] Core waiver save completed:', coreResult);

      const { data: verifyRow, error: verifyErr } = await supabase
        .from('waiver_signatures')
        .select('id, client_submission_id')
        .eq('id', waiverId)
        .maybeSingle();
      if (verifyErr) throw verifyErr;
      if (!verifyRow?.id) {
        throw new Error('Your waiver could not be confirmed after saving. Please try submitting again.');
      }
      if (
        verifyRow.client_submission_id != null &&
        String(verifyRow.client_submission_id) !== String(waiverId)
      ) {
        throw new Error('Waiver confirmation did not match. Please try again or contact support.');
      }

      try {
        WaiverMailIntegration.setBusinessId(businessId);
        await WaiverMailIntegration.syncWaiverToMail(waiverId, signer.data?.email || null);
      } catch (syncError) {
        console.error('[WaiverSubmissionService] Waiver mail sync failed:', syncError);
      }

      try {
        const recipientEmail = signer.data?.email || customerInfo?.email || null;
        const archiveResult = await this.archiveAndEmailWaiver({
          waiverId,
          businessId,
          signatureToken,
          recipientEmail
        });
        console.log('[WaiverSubmissionService] Waiver archive/email result:', archiveResult);
      } catch (archiveEmailError) {
        console.error('[WaiverSubmissionService] Error during archive/email step:', archiveEmailError);
      }

      return {
        success: true,
        waiverId: waiverId
      };
    } catch (error) {
      if (createdWaiverId) {
        await this.rollbackPendingWaiver(createdWaiverId);
      }
      console.error('[WaiverSubmissionService] Error submitting waiver:', error);
      throw new Error(this.getCustomerFacingSubmissionMessage(error));
    }
  }
}

export const waiverSubmissionService = new WaiverSubmissionService();
export default waiverSubmissionService;


