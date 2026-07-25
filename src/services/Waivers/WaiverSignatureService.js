// Step 53: Create WaiverSignatureService.js
// Service for waiver signature operations
import { supabase } from '../../supabaseClient';
import waiverOTPService from './WaiverOTPService';

class WaiverSignatureService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Create signature session (generate token)
  async createSignatureSession(templateId, participantData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Generate signature token
    const { data: tokenData, error: tokenError } = await supabase
      .rpc('waivers_create_signature_token', {
        business_uuid: this.businessId
      });

    if (tokenError) {
      console.error('Error generating signature token:', tokenError);
      throw tokenError;
    }

    let customerId = participantData.customerId || null;
    if (!customerId && (participantData.phoneNumber || participantData.email)) {
      const customerResult = await waiverOTPService.createOrGetCustomer(
        this.businessId,
        participantData.phoneNumber || '',
        participantData.email || '',
        participantData.firstName || '',
        participantData.lastName || ''
      );
      customerId = customerResult?.customerId || customerResult?.customer_id || null;
    }

    // Create waiver signature record
    const { data, error } = await supabase
      .from('waiver_signatures')
      .insert({
        business_id: this.businessId,
        template_id: templateId,
        signature_token: tokenData,
        first_name: participantData.firstName,
        last_name: participantData.lastName,
        date_of_birth: participantData.dateOfBirth,
        phone_number: participantData.phoneNumber,
        email: participantData.email,
        address: participantData.address,
        postal_code: participantData.postalCode,
        customer_id: customerId,
        is_minor: participantData.isMinor || false
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating signature session:', error);
      throw error;
    }

    return data;
  }

  // Sign waiver (update with signature image/data)
  async signWaiver(waiverId, signatureData) {
    const { data: existingWaiver, error: existingWaiverError } = await supabase
      .from('waiver_signatures')
      .select('id, business_id, first_name, last_name, email, phone_number, date_of_birth, address, postal_code, customer_id')
      .eq('id', waiverId)
      .single();

    if (existingWaiverError) {
      console.error('Error loading waiver before signing:', existingWaiverError);
      throw existingWaiverError;
    }

    let customerId = signatureData.customerId || existingWaiver?.customer_id || null;
    const firstName = signatureData.firstName ?? existingWaiver?.first_name ?? '';
    const lastName = signatureData.lastName ?? existingWaiver?.last_name ?? '';
    const email = signatureData.email ?? existingWaiver?.email ?? '';
    const phoneNumber = signatureData.phoneNumber ?? existingWaiver?.phone_number ?? '';

    if (!customerId && (phoneNumber || email)) {
      const customerResult = await waiverOTPService.createOrGetCustomer(
        existingWaiver.business_id,
        phoneNumber,
        email,
        firstName,
        lastName
      );
      customerId = customerResult?.customerId || customerResult?.customer_id || null;
    }

    if (!customerId) {
      throw new Error('Unable to create or link a customer account for this waiver');
    }

    // Use a single timestamp for signed_at to ensure consistency with expiry calculation
    const signedAtTimestamp = new Date();
    const signedAt = signedAtTimestamp.toISOString();
    
    console.log('[WaiverSignatureService] ========== SIGNING WAIVER ==========');
    console.log('[WaiverSignatureService] Waiver ID:', waiverId);
    console.log('[WaiverSignatureService] Expires At from signatureData:', signatureData.expiresAt);
    
    const updateData = {
      first_name: firstName,
      last_name: lastName,
      date_of_birth: signatureData.dateOfBirth ?? existingWaiver?.date_of_birth ?? null,
      phone_number: phoneNumber || null,
      email: email || null,
      address: signatureData.address ?? existingWaiver?.address ?? null,
      postal_code: signatureData.postalCode ?? existingWaiver?.postal_code ?? null,
      customer_id: customerId,
      signature_image_url: signatureData.signatureImageUrl,
      signature_data: signatureData.signatureData || {},
      signed_at: signedAt,
      is_valid: true,
      updated_at: new Date().toISOString()
    };

    if (signatureData.ipAddress) {
      updateData.ip_address = signatureData.ipAddress;
    }

    if (signatureData.userAgent) {
      updateData.user_agent = signatureData.userAgent;
    }

    // CRITICAL: Set expiry date - this MUST be set if provided
    if (signatureData.expiresAt) {
      updateData.expires_at = signatureData.expiresAt;
      console.log('[WaiverSignatureService] ✅ Setting expires_at:', signatureData.expiresAt);
    } else {
      console.warn('[WaiverSignatureService] ⚠️ No expiresAt provided in signatureData');
    }
    
    console.log('[WaiverSignatureService] Update data:', {
      signed_at: updateData.signed_at,
      expires_at: updateData.expires_at,
      hasExpiresAt: !!updateData.expires_at
    });

    const { data, error } = await supabase
      .from('waiver_signatures')
      .update(updateData)
      .eq('id', waiverId)
      .select()
      .single();

    if (error) {
      console.error('Error signing waiver:', error);
      throw error;
    }

    return data;
  }

  // Validate signature (check if valid/expired)
  async validateSignature(waiverId) {
    const { data, error } = await supabase
      .rpc('waivers_check_expiry', {
        waiver_uuid: waiverId
      });

    if (error) {
      console.error('Error validating signature:', error);
      throw error;
    }

    return data;
  }

  // Get signature image URL
  async getSignatureImage(waiverId) {
    const { data, error } = await supabase
      .from('waiver_signatures')
      .select('signature_image_url, guardian_signature_url')
      .eq('id', waiverId)
      .single();

    if (error) {
      console.error('Error fetching signature image:', error);
      throw error;
    }

    return data;
  }

  // Authorize digital signature (record acknowledgment)
  async authorizeDigitalSignature(waiverId, authorizationAcknowledged) {
    const { data, error } = await supabase
      .rpc('waivers_authorize_digital_signature', {
        waiver_uuid: waiverId,
        authorization_acknowledged: authorizationAcknowledged
      });

    if (error) {
      console.error('Error authorizing digital signature:', error);
      throw error;
    }

    return data;
  }

  // Get waiver by signature token (for public signing)
  async getWaiverByToken(signatureToken) {
    const { data, error } = await supabase
      .from('waiver_signatures')
      .select(`
        *,
        waiver_templates:template_id (
          id,
          template_name,
          waiver_title,
          waiver_content,
          requires_digital_signature,
          requires_guardian_signature,
          minor_age_threshold,
          fields_config,
          signature_config,
          expiry_days
        )
      `)
      .eq('signature_token', signatureToken)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No waiver found
        return null;
      }
      console.error('Error fetching waiver by token:', error);
      throw error;
    }

    return data;
  }
}

export default new WaiverSignatureService();




