// src/services/Bookings/BookingWaiverIntegration.js
// Integration service for Bookings → Waivers flow
import { supabase } from '../../supabaseClient';
import waiverService from '../Waivers/WaiversService';
import waiverBookingIntegration from '../Waivers/WaiverBookingIntegration';
import { isWaiverExpired } from '../../utils/waiverUtils';

class BookingWaiverIntegration {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
    waiverService.setBusinessId(businessId);
    waiverBookingIntegration.setBusinessId(businessId);
  }

  // Check if booking/activity requires waiver
  async checkWaiverRequirement(activityId, bookingTypeId = null) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Check activity-level requirement
    const { data: activity, error: activityError } = await supabase
      .from('booking_activities')
      .select('requires_waiver, type_id')
      .eq('id', activityId)
      .eq('business_id', this.businessId)
      .single();

    if (activityError) {
      throw activityError;
    }

    if (activity.requires_waiver) {
      return { requiresWaiver: true, level: 'activity' };
    }

    // Check type-level requirement
    if (bookingTypeId) {
      const { data: bookingType, error: typeError } = await supabase
        .from('booking_types')
        .select('requires_waiver')
        .eq('id', bookingTypeId)
        .eq('business_id', this.businessId)
        .single();

      if (!typeError && bookingType?.requires_waiver) {
        return { requiresWaiver: true, level: 'type' };
      }
    }

    return { requiresWaiver: false };
  }

  // Match existing waivers for participants
  async matchWaiversForParticipants(participants) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const matchedParticipants = await Promise.all(
      participants.map(async (participant) => {
        try {
          // Try to match waiver using WaiversService.matchWaiver()
          // Note: matchWaiver() returns array of waiver records with is_valid field
          const matchedWaivers = await waiverService.matchWaiver(
            participant.firstName,
            participant.lastName,
            participant.phoneNumber || null,
            participant.email || null,
            participant.dateOfBirth || null
          );

          if (matchedWaivers && matchedWaivers.length > 0) {
            // Find a current, valid waiver first, otherwise use the most recent match.
            const validWaiver = matchedWaivers.find(
              (w) => w.is_valid === true && (!w.expires_at || !isWaiverExpired(w.expires_at))
            ) || matchedWaivers[0];
            return {
              ...participant,
              waiverId: validWaiver.id,
              waiverStatus:
                validWaiver.is_valid === true && (!validWaiver.expires_at || !isWaiverExpired(validWaiver.expires_at))
                  ? 'valid'
                  : 'expired'
            };
          }

          return {
            ...participant,
            waiverId: null,
            waiverStatus: 'missing'
          };
        } catch (error) {
          console.error('Error matching waiver for participant:', error);
          return {
            ...participant,
            waiverId: null,
            waiverStatus: 'missing'
          };
        }
      })
    );

    return matchedParticipants;
  }

  // Validate all waivers for a booking
  async validateAllWaivers(bookingId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: participants, error } = await supabase
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
      throw error;
    }

    const validationResults = participants.map(p => {
      if (!p.waiver_id) {
        return { participantId: p.id, valid: false, reason: 'No waiver linked' };
      }

      if (!p.waiver_signatures) {
        return { participantId: p.id, valid: false, reason: 'Waiver not found' };
      }

      const waiver = p.waiver_signatures;
      if (waiver.is_valid !== true || (waiver.expires_at && isWaiverExpired(waiver.expires_at))) {
        return { participantId: p.id, valid: false, reason: 'Waiver expired or invalid' };
      }

      return { participantId: p.id, valid: true };
    });

    const allValid = validationResults.every(r => r.valid);

    return {
      allValid,
      results: validationResults,
      participants: participants
    };
  }

  // Link waivers to booking participants
  async linkWaiversToParticipants(bookingId, participantWaiverMap) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const updates = Object.entries(participantWaiverMap).map(([participantId, waiverId]) => ({
      id: participantId,
      waiver_id: waiverId,
      waiver_status: 'valid'
    }));

    for (const update of updates) {
      await supabase
        .from('booking_participants')
        .update({
          waiver_id: update.waiver_id,
          waiver_status: update.waiver_status
        })
        .eq('id', update.id)
        .eq('booking_id', bookingId);
    }

    return { success: true };
  }

  // Mark participants who still need waivers. Actual waiver creation happens in the live signing flows.
  async createWaiversForParticipants(bookingId, templateId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    return await waiverBookingIntegration.requireWaiverForBooking(bookingId, templateId);
  }
}

export default new BookingWaiverIntegration();












