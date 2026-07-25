// src/services/Bookings/BookingSettingsService.js
import { supabase } from '../../supabaseClient';

class BookingSettingsService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Get setting value
  async getSetting(settingKey, activityId = null) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let query = supabase
      .from('booking_settings')
      .select('*')
      .eq('business_id', this.businessId)
      .eq('setting_key', settingKey);

    if (activityId) {
      query = query.eq('activity_id', activityId);
    } else {
      query = query.is('activity_id', null).eq('is_global', true);
    }

    const { data, error } = await query.order('updated_at', { ascending: false }).limit(1).maybeSingle();

    if (error) {
      if (error.code === 'PGRST116') {
        // No setting found, return null
        return null;
      }
      console.error('Error fetching setting:', error);
      throw error;
    }

    return data?.setting_value || null;
  }

  // Set setting value
  async setSetting(settingKey, settingValue, activityId = null) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const settingData = {
      business_id: this.businessId,
      setting_key: settingKey,
      setting_value: settingValue,
      activity_id: activityId || null,
      is_global: activityId === null
    };

    // Check if setting already exists
    let query = supabase
      .from('booking_settings')
      .select('id')
      .eq('business_id', this.businessId)
      .eq('setting_key', settingKey);

    if (activityId) {
      query = query.eq('activity_id', activityId);
    } else {
      query = query.is('activity_id', null).eq('is_global', true);
    }

    const { data: existing, error: checkError } = await query.order('updated_at', { ascending: false }).limit(1).maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      // PGRST116 is "no rows returned" - that's fine, we'll insert
      console.error('Error checking existing setting:', checkError);
      throw checkError;
    }

    if (existing) {
      // Update existing setting
      const { data, error } = await supabase
        .from('booking_settings')
        .update({
          setting_value: settingValue,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        console.error('Error updating setting:', error);
        throw error;
      }

      return data;
    } else {
      // Insert new setting
      const { data, error } = await supabase
        .from('booking_settings')
        .insert(settingData)
        .select()
        .single();

      if (error) {
        console.error('Error inserting setting:', error);
        throw error;
      }

      return data;
    }
  }

  // Get all settings for business or activity
  async getAllSettings(activityId = null) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let query = supabase
      .from('booking_settings')
      .select('*')
      .eq('business_id', this.businessId);

    if (activityId) {
      query = query.eq('activity_id', activityId);
    } else {
      query = query.is('activity_id', null).eq('is_global', true);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching settings:', error);
      throw error;
    }

    // Convert to key-value object
    const settings = {};
    (data || []).forEach(setting => {
      settings[setting.setting_key] = setting.setting_value;
    });

    return settings;
  }

  // Delete setting
  async deleteSetting(settingKey, activityId = null) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let query = supabase
      .from('booking_settings')
      .delete()
      .eq('business_id', this.businessId)
      .eq('setting_key', settingKey);

    if (activityId) {
      query = query.eq('activity_id', activityId);
    } else {
      query = query.is('activity_id', null).eq('is_global', true);
    }

    const { error } = await query;

    if (error) {
      console.error('Error deleting setting:', error);
      throw error;
    }

    return { success: true };
  }

  // Get booking resources (categories and resources)
  async getBookingResources() {
    const resources = await this.getSetting('booking_resources');
    return resources || [];
  }

  // Set booking resources (categories and resources)
  async setBookingResources(resources) {
    return await this.setSetting('booking_resources', resources);
  }
}

export default new BookingSettingsService();












