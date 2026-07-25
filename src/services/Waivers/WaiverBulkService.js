// Step 77: Create WaiverBulkService.js
// Service for bulk waiver operations
import { supabase } from '../../supabaseClient';
import waiverEmailService from './waiverEmailService';
import waiverSMSService from './waiverSMSService';

class WaiverBulkService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Bulk create waivers
  async bulkCreateWaivers(templateId, participants) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const waivers = await Promise.all(
      participants.map(async (participant) => {
        const { data: signatureToken, error: tokenError } = await supabase.rpc(
          'waivers_create_signature_token',
          { business_uuid: this.businessId }
        );

        if (tokenError) {
          throw tokenError;
        }

        return {
          business_id: this.businessId,
          template_id: templateId,
          signature_token: signatureToken,
          first_name: participant.firstName,
          last_name: participant.lastName,
          date_of_birth: participant.dateOfBirth,
          phone_number: participant.phoneNumber,
          email: participant.email,
          customer_id: participant.customerId,
          is_minor: participant.isMinor || false
        };
      })
    );

    const { data, error } = await supabase
      .from('waiver_signatures')
      .insert(waivers)
      .select();

    if (error) {
      throw error;
    }

    return data;
  }

  // Bulk send waiver links
  async bulkSendLinks(waiverIds, deliveryMethod = 'email') {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    waiverEmailService.setBusinessId(this.businessId);
    waiverSMSService.setBusinessId(this.businessId);

    const results = [];

    for (const waiverId of waiverIds) {
      try {
        const { data: waiver } = await supabase
          .from('waiver_signatures')
          .select('email, phone_number, signature_token')
          .eq('id', waiverId)
          .single();

        if (!waiver) continue;

        if (deliveryMethod === 'email' && waiver.email) {
          await waiverEmailService.sendWaiverLink(waiverId, waiver.email);
          results.push({ waiverId, sent: true, method: 'email' });
        } else if (deliveryMethod === 'sms' && waiver.phone_number) {
          const smsResult = await waiverSMSService.sendWaiverLink(waiverId, waiver.phone_number);
          results.push({
            waiverId,
            sent: smsResult?.smsSent === true,
            method: 'sms',
            reason: smsResult?.reason || null
          });
        } else {
          results.push({ waiverId, sent: false, reason: 'No contact method' });
        }
      } catch (error) {
        results.push({ waiverId, sent: false, error: error.message });
      }
    }

    return results;
  }

  // Bulk expiry check
  async bulkExpiryCheck() {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: waivers } = await supabase
      .from('waiver_signatures')
      .select('id, expires_at, is_valid')
      .eq('business_id', this.businessId)
      .eq('is_valid', true)
      .not('expires_at', 'is', null);

    const now = new Date();
    const expired = [];

    for (const waiver of waivers || []) {
      if (new Date(waiver.expires_at) <= now) {
        expired.push(waiver.id);
      }
    }

    // Mark expired waivers
    if (expired.length > 0) {
      await supabase
        .from('waiver_signatures')
        .update({ is_valid: false })
        .in('id', expired);
    }

    return { checked: waivers?.length || 0, expired: expired.length };
  }

  // Bulk update expiry
  async bulkUpdateExpiry(waiverIds, newExpiryDate) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('waiver_signatures')
      .update({
        expires_at: newExpiryDate,
        updated_at: new Date().toISOString()
      })
      .in('id', waiverIds)
      .eq('business_id', this.businessId)
      .select();

    if (error) {
      throw error;
    }

    return data;
  }
}

export default new WaiverBulkService();




