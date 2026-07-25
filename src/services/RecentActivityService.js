// src/services/RecentActivityService.js
// Service for tracking and retrieving recent activity across modules
import { supabase } from '../supabaseClient';

class RecentActivityService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  /**
   * Track user activity in a module
   * @param {string} moduleKey - Module identifier
   * @param {string} itemType - Type of item (e.g., 'dashboard', 'playlist', 'campaign')
   * @param {string} itemId - ID of the item
   * @param {string} itemName - Display name of the item
   */
  async trackActivity(moduleKey, itemType, itemId = null, itemName = null) {
    if (!this.businessId) {
      console.warn('Business ID not set for RecentActivityService');
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Upsert recent activity (update if exists, insert if new)
      const { error } = await supabase
        .from('user_recent_activity')
        .upsert({
          user_id: user.id,
          business_id: this.businessId,
          module_key: moduleKey,
          item_type: itemType,
          item_id: itemId,
          item_name: itemName,
          accessed_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,business_id,module_key,item_type,item_id'
        });

      if (error) {
        console.error('Error tracking activity:', error);
      }
    } catch (error) {
      console.error('Error in trackActivity:', error);
    }
  }

  /**
   * Get recent activity for a user
   * @param {number} limit - Number of items to return
   * @param {string} moduleKey - Optional filter by module
   */
  async getRecentActivity(limit = 10, moduleKey = null) {
    if (!this.businessId) {
      return [];
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      let query = supabase
        .from('user_recent_activity')
        .select('*')
        .eq('user_id', user.id)
        .eq('business_id', this.businessId)
        .order('accessed_at', { ascending: false })
        .limit(limit);

      if (moduleKey) {
        query = query.eq('module_key', moduleKey);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching recent activity:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getRecentActivity:', error);
      return [];
    }
  }

  /**
   * Clear recent activity for a module or all modules
   * @param {string} moduleKey - Optional module to clear
   */
  async clearActivity(moduleKey = null) {
    if (!this.businessId) {
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let query = supabase
        .from('user_recent_activity')
        .delete()
        .eq('user_id', user.id)
        .eq('business_id', this.businessId);

      if (moduleKey) {
        query = query.eq('module_key', moduleKey);
      }

      const { error } = await query;

      if (error) {
        console.error('Error clearing activity:', error);
      }
    } catch (error) {
      console.error('Error in clearActivity:', error);
    }
  }
}

export default new RecentActivityService();



