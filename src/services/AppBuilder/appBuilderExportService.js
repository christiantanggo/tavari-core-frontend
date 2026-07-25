// Step 80: Create appBuilderExportService.js
// Service for exporting app data

import { supabase } from '../../supabaseClient';

class AppBuilderExportService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Export app configuration as JSON
  async exportAppConfig() {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Get branding
    const { data: branding } = await supabase
      .from('app_branding')
      .select('*')
      .eq('business_id', this.businessId)
      .single();

    // Get enabled modules
    const { data: modules } = await supabase
      .rpc('appbuilder_get_enabled_modules', {
        business_uuid: this.businessId
      });

    // Get store listings
    const { data: listings } = await supabase
      .from('app_store_listings')
      .select('*')
      .eq('business_id', this.businessId);

    const config = {
      business_id: this.businessId,
      exported_at: new Date().toISOString(),
      branding: branding || null,
      enabled_modules: modules || [],
      store_listings: listings || []
    };

    return JSON.stringify(config, null, 2);
  }

  // Export build history as CSV
  async exportBuildHistory() {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: builds } = await supabase
      .from('app_builds')
      .select('*')
      .eq('business_id', this.businessId)
      .order('created_at', { ascending: false });

    if (!builds || builds.length === 0) {
      return 'No builds found';
    }

    const headers = ['Build Number', 'Version', 'Platform', 'Status', 'Created At', 'Completed At'];
    const rows = builds.map(build => [
      build.build_number,
      build.app_version,
      build.platform,
      build.build_status,
      build.created_at,
      build.completed_at || ''
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    return csv;
  }

  // Export analytics as CSV
  async exportAnalytics(filters = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let query = supabase
      .from('app_analytics')
      .select('*')
      .eq('business_id', this.businessId)
      .order('timestamp', { ascending: false });

    if (filters.start_date) {
      query = query.gte('timestamp', filters.start_date);
    }

    if (filters.end_date) {
      query = query.lte('timestamp', filters.end_date);
    }

    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    const { data: analytics } = await query;

    if (!analytics || analytics.length === 0) {
      return 'No analytics data found';
    }

    const headers = ['Timestamp', 'Event Type', 'User ID', 'Event Data'];
    const rows = analytics.map(event => [
      event.timestamp,
      event.event_type,
      event.user_id || '',
      JSON.stringify(event.event_data)
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    return csv;
  }

  // Download file helper
  downloadFile(content, filename, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

export default new AppBuilderExportService();




