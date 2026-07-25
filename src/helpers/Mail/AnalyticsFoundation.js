// helpers/Mail/AnalyticsFoundation.js - Fixed Version
import { supabase } from '../../supabaseClient';
import { getBusinessRangeStartIso } from '../../utils/businessDateFormat';

class AnalyticsFoundation {
  constructor() {
    this.events = [];
    this.experiments = new Map();
    this.performanceMetrics = new Map();
  }

  getContentTypeLabel(type) {
    switch (String(type || '').toLowerCase()) {
      case 'text':
        return 'text sections';
      case 'image':
        return 'image sections';
      case 'button':
        return 'button sections';
      case 'divider':
        return 'divider sections';
      case 'spacer':
        return 'spacing sections';
      default:
        return 'content sections';
    }
  }

  getStartDateForTimeframe(timeframe = '30d', businessTimezone = 'America/Toronto') {
    if (timeframe === 'all') return null;

    const days =
      timeframe === '7d' ? 6 :
      timeframe === '90d' ? 89 :
      29;

    return getBusinessRangeStartIso(days, businessTimezone);
  }

  // A/B Testing Foundation
  async createABTest(campaignId, testName, variants) {
    try {
      const experimentId = `exp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const experiment = {
        id: experimentId,
        campaign_id: campaignId,
        test_name: testName,
        variants: variants.map((variant, index) => ({
          id: `variant_${index}`,
          name: variant.name,
          content_blocks: variant.content_blocks,
          traffic_percentage: variant.traffic_percentage || (100 / variants.length),
          metrics: {
            sends: 0,
            opens: 0,
            clicks: 0,
            conversions: 0
          }
        })),
        status: 'draft',
        start_date: null,
        end_date: null,
        confidence_level: 95,
        minimum_sample_size: 100,
        created_at: new Date().toISOString()
      };

      // Store experiment in database
      const { data, error } = await supabase
        .from('mail_ab_experiments')
        .insert({
          id: experimentId,
          campaign_id: campaignId,
          experiment_data: experiment,
          status: 'draft',
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      this.experiments.set(experimentId, experiment);
      
      return {
        success: true,
        experiment_id: experimentId,
        experiment: experiment
      };
    } catch (error) {
      console.error('Error creating A/B test:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async startABTest(experimentId) {
    try {
      const experiment = this.experiments.get(experimentId);
      if (!experiment) {
        throw new Error('Experiment not found');
      }

      experiment.status = 'running';
      experiment.start_date = new Date().toISOString();

      const { error } = await supabase
        .from('mail_ab_experiments')
        .update({
          experiment_data: experiment,
          status: 'running',
          started_at: new Date().toISOString()
        })
        .eq('id', experimentId);

      if (error) throw error;

      this.experiments.set(experimentId, experiment);

      return {
        success: true,
        message: 'A/B test started successfully'
      };
    } catch (error) {
      console.error('Error starting A/B test:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Content Performance Tracking
  async trackContentPerformance(campaignId, blockId, eventType, metadata = {}) {
    try {
      const event = {
        id: `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        campaign_id: campaignId,
        block_id: blockId,
        event_type: eventType, // 'view', 'click', 'conversion'
        metadata: metadata,
        timestamp: new Date().toISOString()
      };

      // Store in database
      const { error } = await supabase
        .from('mail_content_analytics')
        .insert({
          id: event.id,
          campaign_id: campaignId,
          block_id: blockId,
          event_type: eventType,
          event_data: event,
          created_at: new Date().toISOString()
        });

      if (error) throw error;

      // Update performance metrics
      this.updatePerformanceMetrics(campaignId, blockId, eventType);

      return {
        success: true,
        event_id: event.id
      };
    } catch (error) {
      console.error('Error tracking content performance:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  updatePerformanceMetrics(campaignId, blockId, eventType) {
    const key = `${campaignId}_${blockId}`;
    
    if (!this.performanceMetrics.has(key)) {
      this.performanceMetrics.set(key, {
        campaign_id: campaignId,
        block_id: blockId,
        views: 0,
        clicks: 0,
        conversions: 0,
        last_updated: new Date().toISOString()
      });
    }

    const metrics = this.performanceMetrics.get(key);
    
    switch (eventType) {
      case 'view':
        metrics.views++;
        break;
      case 'click':
        metrics.clicks++;
        break;
      case 'conversion':
        metrics.conversions++;
        break;
    }

    metrics.last_updated = new Date().toISOString();
    this.performanceMetrics.set(key, metrics);
  }

  // Content Block Performance Analysis
  async getContentBlockPerformance(campaignId) {
    try {
      const { data, error } = await supabase
        .from('mail_content_analytics')
        .select('*')
        .eq('campaign_id', campaignId);

      if (error) throw error;

      const blockPerformance = {};

      // Group events by block_id
      data.forEach(record => {
        const { block_id, event_type } = record;
        
        if (!blockPerformance[block_id]) {
          blockPerformance[block_id] = {
            block_id,
            views: 0,
            clicks: 0,
            conversions: 0,
            click_through_rate: 0,
            conversion_rate: 0
          };
        }

        switch (event_type) {
          case 'view':
            blockPerformance[block_id].views++;
            break;
          case 'click':
            blockPerformance[block_id].clicks++;
            break;
          case 'conversion':
            blockPerformance[block_id].conversions++;
            break;
        }
      });

      // Calculate rates
      Object.values(blockPerformance).forEach(metrics => {
        if (metrics.views > 0) {
          metrics.click_through_rate = (metrics.clicks / metrics.views) * 100;
          metrics.conversion_rate = (metrics.conversions / metrics.views) * 100;
        }
      });

      return {
        success: true,
        performance: blockPerformance
      };
    } catch (error) {
      console.error('Error getting content block performance:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Subject Line Testing
  async createSubjectLineTest(campaignId, subjectLines) {
    try {
      const testId = `subject_test_${Date.now()}`;
      
      const test = {
        id: testId,
        campaign_id: campaignId,
        type: 'subject_line',
        variants: subjectLines.map((subject, index) => ({
          id: `subject_${index}`,
          text: subject,
          sends: 0,
          opens: 0,
          open_rate: 0
        })),
        status: 'ready',
        created_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('mail_subject_tests')
        .insert({
          id: testId,
          campaign_id: campaignId,
          test_data: test,
          created_at: new Date().toISOString()
        });

      if (error) throw error;

      return {
        success: true,
        test_id: testId,
        test: test
      };
    } catch (error) {
      console.error('Error creating subject line test:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Campaign Performance Comparison
  async compareCampaignPerformance(campaignIds) {
    try {
      if (!campaignIds || campaignIds.length === 0) {
        return {
          success: true,
          comparison: []
        };
      }

      const { data: campaigns, error: campaignsError } = await supabase
        .from('mail_campaigns')
        .select(`
          id,
          name,
          subject_line,
          total_recipients,
          emails_sent,
          created_at
        `)
        .in('id', campaignIds);

      if (campaignsError) throw campaignsError;

      const { data: statsRows, error: statsError } = await supabase
        .from('mail_campaign_send_stats')
        .select('*')
        .in('campaign_id', campaignIds);

      if (statsError) throw statsError;

      const { data: analytics, error: analyticsError } = await supabase
        .from('mail_content_analytics')
        .select('*')
        .in('campaign_id', campaignIds);

      if (analyticsError) throw analyticsError;

      const comparison = campaigns.map(campaign => {
        const stats = (statsRows || []).find(row => row.campaign_id === campaign.id) || {};
        const campaignAnalytics = analytics.filter(a => a.campaign_id === campaign.id);
        const analyticsViews = campaignAnalytics.filter(
          (a) => a.event_type === 'view' && a.block_id === 'email_open'
        ).length;
        const analyticsClicks = campaignAnalytics.filter(
          (a) => a.event_type === 'click'
        ).length;
        const views = Math.max(Number(stats.opened_count || 0), analyticsViews);
        const clicks = Math.max(Number(stats.clicked_count || 0), analyticsClicks);
        const conversions = campaignAnalytics.filter(a => a.event_type === 'conversion').length;
        const deliveries = Math.max(
          Number(stats.delivered_count || 0),
          Number(stats.sent_count || 0),
          Number(stats.total_sends || 0),
          Number(campaign.emails_sent || 0),
          Number(campaign.total_recipients || 0)
        );
        const computedOpenRate = deliveries > 0 ? (views / deliveries) * 100 : 0;
        const computedClickRate = deliveries > 0 ? (clicks / deliveries) * 100 : 0;
        const computedDeliveryRate = deliveries > 0 ? 100 : Number(stats.delivery_rate || 0);

        return {
          ...campaign,
          emails_sent: Math.max(Number(campaign.emails_sent || 0), Number(stats.sent_count || 0), Number(stats.total_sends || 0)),
          performance: {
            views,
            clicks,
            conversions,
            deliveries,
            bounces: Number(stats.bounced_count || 0),
            unsubscribes: Number(stats.unsubscribed_count || 0),
            view_rate: Math.max(Number(stats.open_rate || 0), computedOpenRate),
            click_rate: Math.max(Number(stats.click_rate || 0), computedClickRate),
            delivery_rate: Math.max(Number(stats.delivery_rate || 0), computedDeliveryRate),
            bounce_rate: Number(stats.bounce_rate || 0),
            click_through_rate: views > 0 ? (clicks / views) * 100 : 0,
            conversion_rate: views > 0 ? (conversions / views) * 100 : 0
          }
        };
      });

      return {
        success: true,
        comparison: comparison
      };
    } catch (error) {
      console.error('Error comparing campaign performance:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Best Performing Content Analysis
  async getBestPerformingContent(businessId, timeframe = '30d', businessTimezone = 'America/Toronto') {
    try {
      const startDate = this.getStartDateForTimeframe(timeframe, businessTimezone);

      let campaignQuery = supabase
        .from('mail_campaigns')
        .select(`
          id,
          name,
          content_json,
          emails_sent
        `)
        .eq('business_id', businessId);

      if (startDate) {
        campaignQuery = campaignQuery.gte('created_at', startDate);
      }

      const { data: campaigns, error: campaignsError } = await campaignQuery;

      if (campaignsError) throw campaignsError;

      if (!campaigns || campaigns.length === 0) {
        return {
          success: true,
          top_content: [],
          analysis_period: timeframe,
          total_campaigns: 0
        };
      }

      let analyticsQuery = supabase
        .from('mail_content_analytics')
        .select('*')
        .in('campaign_id', (campaigns || []).map(c => c.id));

      if (startDate) {
        analyticsQuery = analyticsQuery.gte('created_at', startDate);
      }

      const { data: analytics, error: analyticsError } = await analyticsQuery;

      if (analyticsError) throw analyticsError;

      // Analyze content blocks across campaigns
      const contentAnalysis = {};

      campaigns.forEach(campaign => {
        if (!campaign.content_json) return;

        campaign.content_json.forEach(block => {
          const blockKey = `${block.type}_${JSON.stringify(block.settings || {})}`;
          
          if (!contentAnalysis[blockKey]) {
            contentAnalysis[blockKey] = {
              type: block.type,
              settings: block.settings,
              appearances: 0,
              total_views: 0,
              total_clicks: 0,
              campaigns: []
            };
          }

          contentAnalysis[blockKey].appearances++;
          contentAnalysis[blockKey].campaigns.push(campaign.id);

          // Add analytics for this block
          const blockAnalytics = analytics.filter(a => 
            a.campaign_id === campaign.id && a.block_id === block.id
          );

          blockAnalytics.forEach(analytic => {
            if (analytic.event_type === 'view') {
              contentAnalysis[blockKey].total_views++;
            } else if (analytic.event_type === 'click') {
              contentAnalysis[blockKey].total_clicks++;
            }
          });
        });
      });

      // Calculate performance scores
      const topPerformingContent = Object.entries(contentAnalysis)
        .map(([key, data]) => ({
          ...data,
          avg_click_rate: data.total_views > 0 ? (data.total_clicks / data.total_views) * 100 : 0,
          performance_score: (data.total_clicks * 2) + data.total_views + (data.appearances * 5)
        }))
        .sort((a, b) => b.performance_score - a.performance_score)
        .slice(0, 10);

      return {
        success: true,
        top_content: topPerformingContent,
        analysis_period: timeframe,
        total_campaigns: campaigns.length
      };
    } catch (error) {
      console.error('Error getting best performing content:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Content Recommendations
  generateContentRecommendations(performanceData) {
    const recommendations = [];

    performanceData.forEach(content => {
      if (content.type === 'button' && content.avg_click_rate < 2) {
        recommendations.push({
          type: 'improvement',
          content_type: 'button',
          suggestion: 'Consider using more action-oriented button text or brighter colors',
          current_performance: `${content.avg_click_rate.toFixed(1)}% click rate`,
          impact: 'medium'
        });
      }

      if (content.type === 'image' && content.total_clicks === 0) {
        recommendations.push({
          type: 'improvement',
          content_type: 'image',
          suggestion: 'Add clickable links to images to increase engagement',
          current_performance: 'No clicks recorded',
          impact: 'low'
        });
      }

      if (content.type === 'text' && content.total_views > 100 && content.total_clicks === 0) {
        recommendations.push({
          type: 'improvement',
          content_type: 'text',
          suggestion: 'Add call-to-action links within text content',
          current_performance: `${content.total_views} views, no clicks`,
          impact: 'high'
        });
      }
    });

    // Best practices recommendations
    const bestPerforming = performanceData.slice(0, 3);
    if (bestPerforming.length > 0) {
      recommendations.push({
        type: 'best_practice',
        suggestion: `Your ${this.getContentTypeLabel(bestPerforming[0].type)} perform best. Consider using more of that content style.`,
        impact: 'high'
      });
    }

    return recommendations;
  }

  // Analytics Dashboard Data
  async getAnalyticsDashboardData(businessId, timeframe = '30d', businessTimezone = 'America/Toronto') {
    try {
      const startDate = this.getStartDateForTimeframe(timeframe, businessTimezone);

      // Get campaign performance
      const campaignPerformance = await this.compareCampaignPerformance(
        await this.getCampaignIds(businessId, startDate)
      );

      // Get best content
      const bestContent = await this.getBestPerformingContent(businessId, timeframe, businessTimezone);

      // Generate recommendations
      const recommendations = bestContent.success ? 
        this.generateContentRecommendations(bestContent.top_content) : [];

      return {
        success: true,
        dashboard_data: {
          timeframe,
          campaign_performance: campaignPerformance.success ? campaignPerformance.comparison : [],
          top_content: bestContent.success ? bestContent.top_content : [],
          recommendations,
          generated_at: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('Error getting analytics dashboard data:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getCampaignIds(businessId, startDate) {
    try {
      let query = supabase
        .from('mail_campaigns')
        .select('id')
        .eq('business_id', businessId);

      if (startDate) {
        query = query.gte('created_at', startDate);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data.map(c => c.id);
    } catch (error) {
      console.error('Error getting campaign IDs:', error);
      return [];
    }
  }
}

export default new AnalyticsFoundation();