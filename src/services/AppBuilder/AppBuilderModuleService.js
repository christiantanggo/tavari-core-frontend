// Step 53: Create AppBuilderModuleService.js
// Service for module management operations
import { supabase } from '../../supabaseClient';

const ENABLED_MODULES_CACHE_MS = 30 * 1000;

class AppBuilderModuleService {
  constructor() {
    this.businessId = null;
    this.enabledModulesCache = new Map();
    this.enabledModulesInFlight = new Map();
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Get available modules (from app_modules catalog)
  async getAvailableModules() {
    const { data, error } = await supabase
      .from('app_modules')
      .select('*')
      .order('module_category', { ascending: true })
      .order('module_name', { ascending: true });

    if (error) {
      console.error('Error fetching available modules:', error);
      throw error;
    }

    return data || [];
  }

  // Get enabled modules for business
  async getEnabledModules() {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const cacheKey = this.businessId;
    const cached = this.enabledModulesCache.get(cacheKey);
    if (cached && Date.now() - cached.loadedAt < ENABLED_MODULES_CACHE_MS) {
      return cached.data;
    }

    const inFlight = this.enabledModulesInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const request = (async () => {
      const { data, error } = await supabase
        .rpc('appbuilder_get_enabled_modules', {
          business_uuid: cacheKey
        });

      if (error) {
        console.error('Error fetching enabled modules:', error);
        throw error;
      }

      const modules = data || [];
      this.enabledModulesCache.set(cacheKey, {
        data: modules,
        loadedAt: Date.now()
      });
      return modules;
    })();

    this.enabledModulesInFlight.set(cacheKey, request);
    try {
      return await request;
    } finally {
      this.enabledModulesInFlight.delete(cacheKey);
    }
  }

  invalidateEnabledModulesCache(businessId = this.businessId) {
    if (!businessId) return;
    this.enabledModulesCache.delete(businessId);
    this.enabledModulesInFlight.delete(businessId);
  }

  // Enable module
  async enableModule(moduleKey) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Get module info
    const { data: moduleInfo } = await supabase
      .from('app_modules')
      .select('module_name')
      .eq('module_key', moduleKey)
      .single();

    const { data, error } = await supabase
      .from('business_module_usage')
      .upsert({
        business_id: this.businessId,
        module_key: moduleKey,
        module_name: moduleInfo?.module_name || moduleKey,
        enabled: true,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'business_id,module_key'
      })
      .select()
      .single();

    if (error) {
      console.error('Error enabling module:', error);
      throw error;
    }

    this.invalidateEnabledModulesCache();

    if (moduleKey === 'gift_cards') {
      try {
        const GiftCards = await import('../GiftCards/GiftCardService.js');
        await GiftCards.bootstrapGiftCards(this.businessId);
      } catch (bootstrapErr) {
        console.warn('Gift cards bootstrap failed (non-critical):', bootstrapErr?.message || bootstrapErr);
      }
    }
    if (moduleKey === 'deals') {
      try {
        const Deals = await import('../Deals/DealsService.js');
        await Deals.bootstrapDeals(this.businessId);
      } catch (bootstrapErr) {
        console.warn('Deals bootstrap failed (non-critical):', bootstrapErr?.message || bootstrapErr);
      }
    }

    return data;
  }

  // Disable module
  async disableModule(moduleKey) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('business_module_usage')
      .update({
        enabled: false,
        updated_at: new Date().toISOString()
      })
      .eq('business_id', this.businessId)
      .eq('module_key', moduleKey)
      .select()
      .single();

    if (error) {
      console.error('Error disabling module:', error);
      throw error;
    }

    this.invalidateEnabledModulesCache();
    return data;
  }

  // Toggle module
  async toggleModule(moduleKey, enabled) {
    if (enabled) {
      return await this.enableModule(moduleKey);
    } else {
      return await this.disableModule(moduleKey);
    }
  }

  // Check module access
  async checkModuleAccess(moduleKey) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return false;
    }

    const { data, error } = await supabase
      .rpc('appbuilder_check_module_access', {
        business_uuid: this.businessId,
        module_key: moduleKey,
        user_uuid: user.id
      });

    if (error) {
      console.error('Error checking module access:', error);
      return false;
    }

    return data === true;
  }

  // Update usage counters
  async updateUsageCounters(moduleKey, incrementCount = 1) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { error } = await supabase
      .rpc('appbuilder_update_module_usage', {
        business_uuid: this.businessId,
        module_key: moduleKey,
        increment_count: incrementCount
      });

    if (error) {
      console.error('Error updating module usage:', error);
      throw error;
    }

    return true;
  }
}

export default new AppBuilderModuleService();




