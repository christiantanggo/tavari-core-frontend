// Step 71: Create WaiverBookingIntegration.js
// Integration service for linking waivers to bookings
import { supabase } from '../../supabaseClient';

class WaiverBookingIntegration {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  async assertBookingBelongsToBusiness(bookingId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: booking, error } = await supabase
      .from('bookings')
      .select('id')
      .eq('id', bookingId)
      .eq('business_id', this.businessId)
      .maybeSingle();

    if (error) {
      console.error('Error validating booking business:', error);
      throw error;
    }

    if (!booking) {
      throw new Error('Booking not found for this business');
    }
  }

  async getBookingParticipants(bookingId) {
    await this.assertBookingBelongsToBusiness(bookingId);

    const { data: participants, error } = await supabase
      .from('booking_participants')
      .select('*')
      .eq('booking_id', bookingId);

    if (error) {
      console.error('Error loading booking participants:', error);
      throw error;
    }

    return participants || [];
  }

  // Link waiver to booking
  async linkWaiverToBooking(waiverId, bookingId, participantIds = []) {
    await this.assertBookingBelongsToBusiness(bookingId);

    const requestedIds = Array.isArray(participantIds)
      ? participantIds.filter(Boolean)
      : (participantIds ? [participantIds] : []);
    let targetIds = requestedIds;

    if (targetIds.length === 0) {
      const participants = await this.getBookingParticipants(bookingId);
      if (participants.length !== 1) {
        throw new Error('Participant IDs are required when linking a waiver to a multi-participant booking');
      }
      targetIds = [participants[0].id];
    }

    // Update only the intended booking participants with the waiver_id.
    const { data, error } = await supabase
      .from('booking_participants')
      .update({
        waiver_id: waiverId,
        waiver_status: 'valid',
        updated_at: new Date().toISOString()
      })
      .eq('booking_id', bookingId)
      .in('id', targetIds)
      .select();

    if (error) {
      console.error('Error linking waiver to booking:', error);
      throw error;
    }

    return data;
  }

  // Check booking waiver status
  async checkBookingWaiverStatus(bookingId) {
    await this.assertBookingBelongsToBusiness(bookingId);

    const { data, error } = await supabase
      .from('booking_participants')
      .select(`
        *,
        waiver_signatures:waiver_id (
          id,
          is_valid,
          expires_at,
          signed_at
        )
      `)
      .eq('booking_id', bookingId);

    if (error) {
      console.error('Error checking booking waiver status:', error);
      throw error;
    }

    return data || [];
  }

  // Require waiver for booking
  async requireWaiverForBooking(bookingId, templateId) {
    await this.assertBookingBelongsToBusiness(bookingId);

    const participants = await this.getBookingParticipants(bookingId);
    const participantsNeedingWaivers = participants.filter((participant) => !participant.waiver_id);
    const participantIds = participantsNeedingWaivers.map((participant) => participant.id);

    if (participantIds.length > 0) {
      const { error } = await supabase
        .from('booking_participants')
        .update({
          waiver_status: 'missing',
          updated_at: new Date().toISOString()
        })
        .eq('booking_id', bookingId)
        .in('id', participantIds);

      if (error) {
        console.error('Error marking booking participants as needing waivers:', error);
        throw error;
      }
    }

    return {
      templateId: templateId || null,
      waiversCreated: false,
      participantsNeedingWaivers
    };
  }
}

export default new WaiverBookingIntegration();




