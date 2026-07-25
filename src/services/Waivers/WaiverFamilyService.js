// Step 76: Create WaiverFamilyService.js
// Service for family waiver management
// Uses existing pos_loyalty_accounts and mail_households tables
import { supabase } from '../../supabaseClient';

class WaiverFamilyService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Create family waiver (multiple adults signing same waiver)
  async createFamilyWaiver(templateId, familyMembers) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Use RPC function if available
    const { data, error } = await supabase
      .rpc('waivers_create_family_waiver', {
        business_uuid: this.businessId,
        template_uuid: templateId,
        family_members: familyMembers
      });

    if (error) {
      // Fallback: create manually
      return this.createFamilyWaiverManual(templateId, familyMembers);
    }

    return data;
  }

  // Manual family waiver creation
  async createFamilyWaiverManual(templateId, familyMembers) {
    // Create primary waiver
    const primaryMember = familyMembers[0];
    const { data: primaryWaiver, error: waiverError } = await supabase
      .from('waiver_signatures')
      .insert({
        business_id: this.businessId,
        template_id: templateId,
        first_name: primaryMember.firstName,
        last_name: primaryMember.lastName,
        date_of_birth: primaryMember.dateOfBirth,
        phone_number: primaryMember.phoneNumber,
        email: primaryMember.email,
        customer_id: primaryMember.customerId
      })
      .select()
      .single();

    if (waiverError) {
      throw waiverError;
    }

    // Add additional family members as participants
    const additionalMembers = familyMembers.slice(1);
    for (const member of additionalMembers) {
      await supabase
        .from('waiver_participants')
        .insert({
          waiver_id: primaryWaiver.id,
          participant_type: 'additional_adult',
          first_name: member.firstName,
          last_name: member.lastName,
          date_of_birth: member.dateOfBirth,
          phone_number: member.phoneNumber,
          email: member.email
        });
    }

    return primaryWaiver;
  }

  // Link family members to existing waiver
  async linkFamilyMembers(waiverId, familyMemberIds) {
    // Get family members from loyalty accounts or households
    const { data: members } = await supabase
      .from('pos_loyalty_accounts')
      .select('customer_id, first_name, last_name, email, phone_number')
      .eq('business_id', this.businessId)
      .in('customer_id', familyMemberIds);

    // Add as participants
    const participantPromises = members.map(member =>
      supabase
        .from('waiver_participants')
        .insert({
          waiver_id: waiverId,
          participant_type: 'additional_adult',
          first_name: member.first_name,
          last_name: member.last_name,
          email: member.email,
          phone_number: member.phone_number
        })
    );

    await Promise.all(participantPromises);

    return { linked: members.length };
  }

  // Share waiver access with family members
  async shareWaiverAccess(waiverId, familyMemberEmails) {
    // This would typically send email links to family members
    // For now, just log the action
    
    const { data: waiver } = await supabase
      .from('waiver_signatures')
      .select('signature_token')
      .eq('id', waiverId)
      .single();

    const waiverUrl = `${window.location.origin}/waivers/sign/${waiver.signature_token}`;

    // Send emails to family members (would use mail service)
    console.log('Sharing waiver access:', waiverUrl, 'with:', familyMemberEmails);

    return { shared: true, url: waiverUrl };
  }

  // Get family waivers
  async getFamilyWaivers(customerId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Get waivers for customer and their family
    const { data: waivers } = await supabase
      .from('waiver_signatures')
      .select(`
        *,
        waiver_participants (*)
      `)
      .eq('business_id', this.businessId)
      .or(`customer_id.eq.${customerId},id.in.(
        SELECT waiver_id FROM waiver_participants 
        WHERE customer_id = '${customerId}'
      )`)
      .order('signed_at', { ascending: false });

    return waivers || [];
  }
}

export default new WaiverFamilyService();




