// Step 55: Create AppBuilderDeploymentService.js
// Service for deployment management operations
import { supabase } from '../../supabaseClient';

class AppBuilderDeploymentService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Submit to store
  async submitToStore(buildId, deploymentData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Verify build belongs to business
    const { data: build } = await supabase
      .from('app_builds')
      .select('id, business_id')
      .eq('id', buildId)
      .eq('business_id', this.businessId)
      .single();

    if (!build) {
      throw new Error('Build not found or access denied');
    }

    const { data, error } = await supabase
      .from('app_deployments')
      .insert({
        build_id: buildId,
        deployment_type: deploymentData.deployment_type,
        status: 'pending',
        submission_date: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('Error submitting to store:', error);
      throw error;
    }

    return data;
  }

  // Get deployment status
  async getDeploymentStatus(deploymentId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('app_deployments')
      .select(`
        *,
        build:app_builds(*)
      `)
      .eq('id', deploymentId)
      .single();

    if (error) {
      console.error('Error fetching deployment status:', error);
      throw error;
    }

    // Verify deployment belongs to business
    if (data?.build?.business_id !== this.businessId) {
      throw new Error('Deployment not found or access denied');
    }

    return data;
  }

  // Update listing
  async updateListing(listingData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('app_store_listings')
      .upsert({
        business_id: this.businessId,
        ...listingData,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'business_id,platform'
      })
      .select()
      .single();

    if (error) {
      console.error('Error updating listing:', error);
      throw error;
    }

    return data;
  }

  // Get store status
  async getStoreStatus(platform) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('app_store_listings')
      .select('*')
      .eq('business_id', this.businessId)
      .eq('platform', platform)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error fetching store status:', error);
      throw error;
    }

    return data;
  }

  // Get deployments for build
  async getDeploymentsForBuild(buildId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('app_deployments')
      .select('*')
      .eq('build_id', buildId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching deployments:', error);
      throw error;
    }

    return data || [];
  }
}

export default new AppBuilderDeploymentService();




