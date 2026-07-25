// Step 58: Create AppBuilderAnalyticsService.js
// Service for analytics operations
import { supabase } from '../../supabaseClient';

class AppBuilderAnalyticsService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Track event
  async trackEvent(eventType, eventData = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from('app_analytics')
      .insert({
        business_id: this.businessId,
        event_type: eventType,
        event_data: eventData,
        user_id: user?.id || null,
        timestamp: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('Error tracking event:', error);
      throw error;
    }

    return data;
  }

  // Get analytics
  async getAnalytics(filters = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let query = supabase
      .from('app_analytics')
      .select('*')
      .eq('business_id', this.businessId)
      .order('timestamp', { ascending: false });

    if (filters.event_type) {
      query = query.eq('event_type', filters.event_type);
    }

    if (filters.start_date) {
      query = query.gte('timestamp', filters.start_date);
    }

    if (filters.end_date) {
      query = query.lte('timestamp', filters.end_date);
    }

    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching analytics:', error);
      throw error;
    }

    return data || [];
  }

  // Get app stats
  async getAppStats(dateRange = '30d') {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const startDate = new Date();
    if (dateRange === '7d') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (dateRange === '30d') {
      startDate.setDate(startDate.getDate() - 30);
    } else if (dateRange === '90d') {
      startDate.setDate(startDate.getDate() - 90);
    }

    const { data, error } = await supabase
      .from('app_analytics')
      .select('event_type, timestamp')
      .eq('business_id', this.businessId)
      .gte('timestamp', startDate.toISOString())
      .order('timestamp', { ascending: false });

    if (error) {
      console.error('Error fetching app stats:', error);
      throw error;
    }

    // Aggregate stats
    const stats = {
      total_events: data?.length || 0,
      events_by_type: {},
      events_by_day: {}
    };

    data?.forEach(event => {
      // Count by type
      stats.events_by_type[event.event_type] = 
        (stats.events_by_type[event.event_type] || 0) + 1;

      // Count by day
      const day = new Date(event.timestamp).toISOString().split('T')[0];
      stats.events_by_day[day] = (stats.events_by_day[day] || 0) + 1;
    });

    return stats;
  }

  // Export analytics
  async exportAnalytics(filters = {}) {
    const analytics = await this.getAnalytics(filters);
    
    // Convert to CSV format
    const headers = ['timestamp', 'event_type', 'user_id', 'event_data'];
    const rows = analytics.map(event => [
      event.timestamp,
      event.event_type,
      event.user_id || '',
      JSON.stringify(event.event_data)
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    return csv;
  }
}

export default new AppBuilderAnalyticsService();




