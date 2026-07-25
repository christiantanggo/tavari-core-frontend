// src/services/Bookings/BookingAvailabilityService.js
import { supabase } from '../../supabaseClient';

class BookingAvailabilityService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Check availability for a specific time slot
  async checkAvailability(activityId, date, startTime, endTime) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .rpc('check_booking_availability', {
        activity_uuid: activityId,
        session_date: date,
        start_time: startTime,
        end_time: endTime
      });

    if (error) {
      console.error('Error checking availability:', error);
      throw error;
    }

    return data || 0;
  }

  // Get available time slots for a date
  async getAvailableTimeSlots(activityId, date) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Get activity details
    const { data: activity, error: activityError } = await supabase
      .from('booking_activities')
      .select('duration_minutes, max_capacity')
      .eq('id', activityId)
      .eq('business_id', this.businessId)
      .single();

    if (activityError) {
      throw activityError;
    }

    // Get sessions for this date
    const { data: sessions, error: sessionsError } = await supabase
      .from('booking_sessions')
      .select('*')
      .eq('activity_id', activityId)
      .eq('session_date', date)
      .eq('status', 'scheduled')
      .order('start_time', { ascending: true });

    if (sessionsError) {
      throw sessionsError;
    }

    // Return sessions with availability
    return (sessions || []).map(session => ({
      ...session,
      availableSpots: session.available_spots,
      isAvailable: session.available_spots > 0
    }));
  }

  // Generate time slots for a date range
  async generateTimeSlots(activityId, startDate, endDate, intervalMinutes = 30) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Get activity duration
    const { data: activity, error: activityError } = await supabase
      .from('booking_activities')
      .select('duration_minutes, max_capacity')
      .eq('id', activityId)
      .eq('business_id', this.businessId)
      .single();

    if (activityError) {
      throw activityError;
    }

    const slots = [];
    const currentDate = new Date(startDate);
    const endDateObj = new Date(endDate);

    while (currentDate <= endDateObj) {
      const dateStr = currentDate.toISOString().split('T')[0];
      
      // Generate time slots for this day (9 AM to 9 PM)
      for (let hour = 9; hour < 21; hour++) {
        for (let minute = 0; minute < 60; minute += intervalMinutes) {
          const startTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`;
          const endTimeObj = new Date(`${dateStr}T${startTime}`);
          endTimeObj.setMinutes(endTimeObj.getMinutes() + activity.duration_minutes);
          const endTime = endTimeObj.toTimeString().split(' ')[0];

          slots.push({
            date: dateStr,
            start_time: startTime,
            end_time: endTime,
            activity_id: activityId,
            max_capacity: activity.max_capacity
          });
        }
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return slots;
  }
}

export default new BookingAvailabilityService();












