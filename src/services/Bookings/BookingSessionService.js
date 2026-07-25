// src/services/Bookings/BookingSessionService.js
import { supabase } from '../../supabaseClient';

class BookingSessionService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Get sessions for an activity and date range
  async getSessions(activityId, startDate, endDate) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('booking_sessions')
      .select(`
        *,
        booking_activities:activity_id (
          activity_name,
          max_capacity
        )
      `)
      .eq('activity_id', activityId)
      .eq('business_id', this.businessId)
      .gte('session_date', startDate)
      .lte('session_date', endDate)
      .order('session_date', { ascending: true })
      .order('start_time', { ascending: true });

    if (error) {
      console.error('Error fetching sessions:', error);
      throw error;
    }

    return data || [];
  }

  // Get single session by ID
  async getSessionById(sessionId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('booking_sessions')
      .select(`
        *,
        booking_activities:activity_id (*)
      `)
      .eq('id', sessionId)
      .eq('business_id', this.businessId)
      .single();

    if (error) {
      console.error('Error fetching session:', error);
      throw error;
    }

    return data;
  }

  // Create session
  async createSession(sessionData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Get activity to get default capacity if not provided
    let maxCapacity = sessionData.maxCapacity;
    if (!maxCapacity) {
      const { data: activity } = await supabase
        .from('booking_activities')
        .select('max_capacity')
        .eq('id', sessionData.activityId)
        .single();
      
      maxCapacity = activity?.max_capacity || 10;
    }

    const { data, error } = await supabase
      .from('booking_sessions')
      .insert({
        business_id: this.businessId,
        activity_id: sessionData.activityId,
        session_date: sessionData.sessionDate,
        start_time: sessionData.startTime,
        end_time: sessionData.endTime,
        max_capacity: maxCapacity,
        current_bookings: 0,
        status: sessionData.status || 'scheduled'
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating session:', error);
      throw error;
    }

    return data;
  }

  // Update session
  async updateSession(sessionId, updates) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('booking_sessions')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .eq('business_id', this.businessId)
      .select()
      .single();

    if (error) {
      console.error('Error updating session:', error);
      throw error;
    }

    return data;
  }

  // Delete session
  async deleteSession(sessionId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { error } = await supabase
      .from('booking_sessions')
      .delete()
      .eq('id', sessionId)
      .eq('business_id', this.businessId);

    if (error) {
      console.error('Error deleting session:', error);
      throw error;
    }

    return { success: true };
  }
}

export default new BookingSessionService();












