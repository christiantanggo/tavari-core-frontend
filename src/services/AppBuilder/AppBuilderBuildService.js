// Step 54: Create AppBuilderBuildService.js
// Service for build management operations
import { supabase } from '../../supabaseClient';

class AppBuilderBuildService {
  constructor() {
    this.businessId = null;
    this.subscriptions = new Map();
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Create new build
  async createBuild(buildData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('User must be authenticated');
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
        created_by: user.id
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating build:', error);
      throw error;
    }

    return data;
  }

  // Get build by ID
  async getBuild(buildId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('app_builds')
      .select('*')
      .eq('id', buildId)
      .eq('business_id', this.businessId)
      .single();

    if (error) {
      console.error('Error fetching build:', error);
      throw error;
    }

    return data;
  }

  // Get build history
  async getBuildHistory(filters = {}) {
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

    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching build history:', error);
      throw error;
    }

    return data || [];
  }

  // Get build status
  async getBuildStatus(buildId) {
    const build = await this.getBuild(buildId);
    return build?.build_status || null;
  }

  // Cancel build
  async cancelBuild(buildId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('app_builds')
      .update({
        build_status: 'cancelled',
        completed_at: new Date().toISOString()
      })
      .eq('id', buildId)
      .eq('business_id', this.businessId)
      .select()
      .single();

    if (error) {
      console.error('Error cancelling build:', error);
      throw error;
    }

    return data;
  }

  // Subscribe to build status changes
  subscribeToBuildStatus(buildId, callback) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Remove existing subscription if any
    this.unsubscribeFromBuildStatus(buildId);

    const subscription = supabase
      .channel(`app_builds:${buildId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'app_builds',
          filter: `id=eq.${buildId}`
        },
        (payload) => {
          callback(payload.new);
        }
      )
      .subscribe();

    this.subscriptions.set(buildId, subscription);

    return () => this.unsubscribeFromBuildStatus(buildId);
  }

  // Unsubscribe from build status
  unsubscribeFromBuildStatus(buildId) {
    const subscription = this.subscriptions.get(buildId);
    if (subscription) {
      supabase.removeChannel(subscription);
      this.subscriptions.delete(buildId);
    }
  }

  // Cleanup all subscriptions
  cleanup() {
    this.subscriptions.forEach((subscription) => {
      supabase.removeChannel(subscription);
    });
    this.subscriptions.clear();
  }
}

export default new AppBuilderBuildService();




