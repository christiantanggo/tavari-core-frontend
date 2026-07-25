// src/services/Bookings/SeasonalPeriodService.js
import { supabase } from '../../supabaseClient';

class SeasonalPeriodService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Get all seasonal periods
  async getSeasonalPeriods(includeInactive = false) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let query = supabase
      .from('booking_seasonal_periods')
      .select('*')
      .eq('business_id', this.businessId)
      .order('start_date', { ascending: true });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching seasonal periods:', error);
      throw error;
    }

    return data || [];
  }

  // Get single seasonal period by ID
  async getSeasonalPeriodById(periodId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('booking_seasonal_periods')
      .select('*')
      .eq('id', periodId)
      .eq('business_id', this.businessId)
      .single();

    if (error) {
      console.error('Error fetching seasonal period:', error);
      throw error;
    }

    return data;
  }

  // Create seasonal period
  async createSeasonalPeriod(periodData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('booking_seasonal_periods')
      .insert({
        business_id: this.businessId,
        period_name: periodData.period_name || periodData.name,
        description: periodData.description || null,
        start_date: periodData.start_date,
        end_date: periodData.end_date,
        start_time: periodData.is_full_day ? null : periodData.start_time || null,
        end_time: periodData.is_full_day ? null : periodData.end_time || null,
        is_full_day: periodData.is_full_day !== false,
        is_active: periodData.is_active !== false
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating seasonal period:', error);
      throw error;
    }

    return data;
  }

  // Update seasonal period
  async updateSeasonalPeriod(periodId, updates) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('booking_seasonal_periods')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', periodId)
      .eq('business_id', this.businessId)
      .select()
      .single();

    if (error) {
      console.error('Error updating seasonal period:', error);
      throw error;
    }

    return data;
  }

  // Delete seasonal period (hard delete - permanently removes from database)
  async deleteSeasonalPeriod(periodId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { error } = await supabase
      .from('booking_seasonal_periods')
      .delete()
      .eq('id', periodId)
      .eq('business_id', this.businessId);

    if (error) {
      console.error('Error deleting seasonal period:', error);
      throw error;
    }
  }

  // Toggle seasonal period active/inactive status
  async toggleSeasonalPeriodStatus(periodId, isActive) {
    return this.updateSeasonalPeriod(periodId, { is_active: isActive });
  }
}

export default new SeasonalPeriodService();
