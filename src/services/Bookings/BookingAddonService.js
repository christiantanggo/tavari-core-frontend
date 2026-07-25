// src/services/Bookings/BookingAddonService.js
import { supabase } from '../../supabaseClient';

class BookingAddonService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Get all addons
  async getAddons(filters = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let query = supabase
      .from('booking_addons')
      .select('*')
      .eq('business_id', this.businessId)
      .order('addon_name', { ascending: true });

    if (filters.activityId) {
      query = query.contains('activity_ids', [filters.activityId]);
    }

    if (filters.globalOnly) {
      query = query.eq('is_global', true);
    }

    if (filters.activeOnly !== false) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching addons:', error);
      throw error;
    }

    return data || [];
  }

  // Get addons for a specific activity
  async getAddonsForActivity(activityId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Get global addons and activity-specific addons
    const { data, error } = await supabase
      .from('booking_addons')
      .select('*')
      .eq('business_id', this.businessId)
      .eq('is_active', true)
      .or(`is_global.eq.true,activity_ids.cs.{${activityId}}`)
      .order('addon_name', { ascending: true });

    if (error) {
      console.error('Error fetching addons for activity:', error);
      throw error;
    }

    return data || [];
  }

  // Get single addon by ID
  async getAddonById(addonId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('booking_addons')
      .select('*')
      .eq('id', addonId)
      .eq('business_id', this.businessId)
      .single();

    if (error) {
      console.error('Error fetching addon:', error);
      throw error;
    }

    return data;
  }

  // Create addon
  async createAddon(addonData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('booking_addons')
      .insert({
        business_id: this.businessId,
        addon_name: addonData.addonName,
        addon_key: addonData.addonKey,
        description: addonData.description || null,
        price: addonData.price || 0,
        is_global: addonData.isGlobal || false,
        activity_ids: addonData.activityIds || null,
        inventory_tracked: addonData.inventoryTracked || false,
        current_stock: addonData.currentStock || null,
        is_active: addonData.isActive !== false
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating addon:', error);
      throw error;
    }

    return data;
  }

  // Update addon
  async updateAddon(addonId, updates) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('booking_addons')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', addonId)
      .eq('business_id', this.businessId)
      .select()
      .single();

    if (error) {
      console.error('Error updating addon:', error);
      throw error;
    }

    return data;
  }

  // Delete addon (soft delete)
  async deleteAddon(addonId) {
    return this.updateAddon(addonId, { is_active: false });
  }
}

export default new BookingAddonService();












