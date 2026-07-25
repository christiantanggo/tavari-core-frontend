// Step 54: Create WaiverParticipantService.js
// Service for waiver participant management operations
import { supabase } from '../../supabaseClient';

class WaiverParticipantService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Get participants for a waiver
  async getParticipants(waiverId) {
    if (!waiverId) {
      return [];
    }
    
    const { data, error } = await supabase
      .from('waiver_participants')
      .select('*')
      .eq('waiver_id', waiverId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[WaiverParticipantService] Error fetching participants:', error);
      throw error;
    }
    return data || [];
  }

  // Add participant to waiver
  async addParticipant(waiverId, participantData) {
    const { data, error } = await supabase
      .from('waiver_participants')
      .insert({
        waiver_id: waiverId,
        participant_type: participantData.participantType,
        first_name: participantData.firstName,
        last_name: participantData.lastName,
        date_of_birth: participantData.dateOfBirth,
        phone_number: participantData.phoneNumber,
        email: participantData.email,
        address: participantData.address ?? null,
        city: participantData.city ?? null,
        postal_code: participantData.postalCode ?? null,
        relationship_to_minor: participantData.relationshipToMinor,
        signature_image_url: participantData.signatureImageUrl,
        signature_data: participantData.signatureData,
        signed_at: participantData.signedAt || new Date().toISOString(),
        is_required: participantData.isRequired !== undefined ? participantData.isRequired : false
      })
      .select()
      .single();

    if (error) {
      console.error('Error adding participant:', error);
      throw error;
    }

    return data;
  }

  // Update participant
  async updateParticipant(participantId, participantData) {
    const updateData = {};

    if (participantData.firstName !== undefined) updateData.first_name = participantData.firstName;
    if (participantData.lastName !== undefined) updateData.last_name = participantData.lastName;
    if (participantData.dateOfBirth !== undefined) updateData.date_of_birth = participantData.dateOfBirth;
    if (participantData.phoneNumber !== undefined) updateData.phone_number = participantData.phoneNumber;
    if (participantData.email !== undefined) updateData.email = participantData.email;
    if (participantData.address !== undefined) updateData.address = participantData.address;
    if (participantData.city !== undefined) updateData.city = participantData.city;
    if (participantData.postalCode !== undefined) updateData.postal_code = participantData.postalCode;
    if (participantData.relationshipToMinor !== undefined) updateData.relationship_to_minor = participantData.relationshipToMinor;
    if (participantData.signatureImageUrl !== undefined) updateData.signature_image_url = participantData.signatureImageUrl;
    if (participantData.signatureData !== undefined) updateData.signature_data = participantData.signatureData;
    if (participantData.signedAt !== undefined) updateData.signed_at = participantData.signedAt;

    const { data, error } = await supabase
      .from('waiver_participants')
      .update(updateData)
      .eq('id', participantId)
      .select()
      .single();

    if (error) {
      console.error('Error updating participant:', error);
      throw error;
    }

    return data;
  }

  // Remove participant
  async removeParticipant(participantId) {
    const { error } = await supabase
      .from('waiver_participants')
      .delete()
      .eq('id', participantId);

    if (error) {
      console.error('Error removing participant:', error);
      throw error;
    }

    return true;
  }

  // Check if guardian signature is required
  async requireGuardianSignature(waiverId, participantDateOfBirth) {
    const { data, error } = await supabase
      .rpc('waivers_require_guardian_signature', {
        waiver_uuid: waiverId,
        participant_dob: participantDateOfBirth
      });

    if (error) {
      console.error('Error checking guardian signature requirement:', error);
      throw error;
    }

    return data;
  }

  // Sign guardian waiver
  async signGuardianWaiver(waiverId, guardianData) {
    // Update main waiver with guardian signature
    const { data, error } = await supabase
      .from('waiver_signatures')
      .update({
        guardian_signature_url: guardianData.signatureImageUrl,
        guardian_signature_data: guardianData.signatureData,
        guardian_name: guardianData.guardianName,
        updated_at: new Date().toISOString()
      })
      .eq('id', waiverId)
      .select()
      .single();

    if (error) {
      console.error('Error signing guardian waiver:', error);
      throw error;
    }

    // Also add guardian as participant
    await this.addParticipant(waiverId, {
      participantType: 'guardian',
      firstName: guardianData.firstName,
      lastName: guardianData.lastName,
      phoneNumber: guardianData.phoneNumber,
      email: guardianData.email,
      signatureImageUrl: guardianData.signatureImageUrl,
      signatureData: guardianData.signatureData,
      signedAt: new Date().toISOString(),
      isRequired: true
    });

    return data;
  }
}

export default new WaiverParticipantService();




