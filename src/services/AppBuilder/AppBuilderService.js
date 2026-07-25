// Step 51: Create AppBuilderService.js
// Core service for AppBuilder functionality
import { supabase } from '../../supabaseClient';

class AppBuilderService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Get branding configuration
  async getBranding() {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('app_branding')
      .select('*')
      .eq('business_id', this.businessId)
      .maybeSingle(); // Use maybeSingle() instead of single() to handle 0 rows gracefully

    if (error) {
      console.error('Error fetching branding:', error);
      // If no branding exists, return null instead of throwing
      if (error.code === 'PGRST116') {
        return null;
      }
      throw error;
    }

    return data; // Will be null if no rows found
  }

  // Update branding configuration
  async updateBranding(brandingData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('app_branding')
      .upsert({
        business_id: this.businessId,
        ...brandingData,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'business_id'
      })
      .select()
      .single();

    if (error) {
      console.error('Error updating branding:', error);
      throw error;
    }

    return data;
  }

  // Get enabled modules for business
  async getEnabledModules() {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .rpc('appbuilder_get_enabled_modules', {
        business_uuid: this.businessId
      });

    if (error) {
      console.error('Error fetching enabled modules:', error);
      throw error;
    }

    return data || [];
  }

  // Toggle module (enable/disable)
  async toggleModule(moduleKey, enabled) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Get module info from app_modules
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
        enabled: enabled,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'business_id,module_key'
      })
      .select()
      .single();

    if (error) {
      console.error('Error toggling module:', error);
      throw error;
    }

    return data;
  }

  // Get builds for business
  async getBuilds(filters = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let query = supabase
      .from('app_builds')
      .select('*')
      .eq('business_id', this.businessId)
      .order('created_at', { ascending: false });

    if (filters.platform) {
      query = query.eq('platform', filters.platform);
    }

    if (filters.status) {
      query = query.eq('build_status', filters.status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching builds:', error);
      throw error;
    }

    return data || [];
  }

  // Create new build
  async createBuild(buildData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Get next build number
    const { data: buildNumber, error: buildNumberError } = await supabase
      .rpc('appbuilder_get_next_build_number', {
        business_uuid: this.businessId,
        platform: buildData.platform
      });

    if (buildNumberError) {
      console.error('Error getting build number:', buildNumberError);
      throw buildNumberError;
    }

    const { data, error } = await supabase
      .from('app_builds')
      .insert({
        business_id: this.businessId,
        app_version: buildData.app_version,
        platform: buildData.platform,
        build_number: buildNumber,
        build_status: 'queued',
        created_by: (await supabase.auth.getUser()).data.user?.id
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating build:', error);
      throw error;
    }

    return data;
  }

  // Refresh data
  async refresh() {
    // This can be called to refresh all data
    return Promise.all([
      this.getBranding(),
      this.getEnabledModules(),
      this.getBuilds()
    ]);
  }
}

export default new AppBuilderService();

