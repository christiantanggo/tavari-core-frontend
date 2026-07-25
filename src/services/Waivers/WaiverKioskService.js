// Step 74: Create WaiverKioskService.js
// Service for kiosk waiver signing flow
// Uses existing pos_loyalty_accounts table for customer lookup
import { supabase } from '../../supabaseClient';
import { normalizePhoneDigits } from '../../utils/waiverExistingViewerAccess';

class WaiverKioskService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  async findCustomerByPhone(phoneNumber) {
    const normalizedPhone = normalizePhoneDigits(phoneNumber);
    const { data: rows, error } = await supabase
      .from('pos_loyalty_accounts')
      .select('id, customer_phone')
      .eq('business_id', this.businessId)
      .eq('is_active', true);

    if (error) {
      throw error;
    }

    return (rows || []).find((row) => normalizePhoneDigits(row.customer_phone) === normalizedPhone) || null;
  }

  async findCustomerByEmail(email) {
    const { data: customer, error } = await supabase
      .from('pos_loyalty_accounts')
      .select('id, customer_email')
      .eq('business_id', this.businessId)
      .eq('is_active', true)
      .ilike('customer_email', `%${email}%`)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    return customer || null;
  }

  // Lookup waiver by phone
  async lookupWaiverByPhone(phoneNumber) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const customer = await this.findCustomerByPhone(phoneNumber);

    if (customer) {
      // Get waivers for this customer
      const { data: waivers } = await supabase
        .from('waiver_signatures')
        .select('*')
        .eq('business_id', this.businessId)
        .eq('customer_id', customer.id)
        .eq('is_valid', true)
        .order('signed_at', { ascending: false });

      return waivers || [];
    }

    // Fallback: search by phone in waiver_signatures
    const { data: waivers } = await supabase
      .from('waiver_signatures')
      .select('*')
      .eq('business_id', this.businessId)
      .ilike('phone_number', `%${phoneNumber}%`)
      .eq('is_valid', true)
      .order('signed_at', { ascending: false });

    return waivers || [];
  }

  // Lookup waiver by email
  async lookupWaiverByEmail(email) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const customer = await this.findCustomerByEmail(email);

    if (customer) {
      // Get waivers for this customer
      const { data: waivers } = await supabase
        .from('waiver_signatures')
        .select('*')
        .eq('business_id', this.businessId)
        .eq('customer_id', customer.id)
        .eq('is_valid', true)
        .order('signed_at', { ascending: false });

      return waivers || [];
    }

    // Fallback: search by email in waiver_signatures
    const { data: waivers } = await supabase
      .from('waiver_signatures')
      .select('*')
      .eq('business_id', this.businessId)
      .ilike('email', email)
      .eq('is_valid', true)
      .order('signed_at', { ascending: false });

    return waivers || [];
  }

  // Show existing waiver
  async showExistingWaiver(waiverId) {
    const { data: waiver, error } = await supabase
      .from('waiver_signatures')
      .select(`
        *,
        waiver_templates:template_id (
          template_name,
          waiver_title
        )
      `)
      .eq('id', waiverId)
      .single();

    if (error) {
      throw error;
    }

    return waiver;
  }

  // Add people to waiver (family waiver)
  async addPeopleToWaiver(waiverId, participants) {
    const { data: waiver } = await supabase
      .from('waiver_signatures')
      .select('*')
      .eq('id', waiverId)
      .single();

    if (!waiver) {
      throw new Error('Waiver not found');
    }

    // Add participants
    const participantPromises = participants.map(async (participant) => {
      const { data, error } = await supabase
        .from('waiver_participants')
        .insert({
          waiver_id: waiverId,
          participant_type: participant.participantType || 'additional_adult',
          first_name: participant.firstName,
          last_name: participant.lastName,
          date_of_birth: participant.dateOfBirth,
          phone_number: participant.phoneNumber,
          email: participant.email,
          is_required: participant.isRequired || false
        })
        .select()
        .single();

      if (error) {
        console.error('Error adding participant:', error);
        return null;
      }

      return data;
    });

    const results = await Promise.all(participantPromises);
    return results.filter(r => r !== null);
  }
}

export default new WaiverKioskService();




