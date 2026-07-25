// src/services/Ads/AdManager.js
import { supabase } from '../../supabaseClient';
import SpotifyAdAPI from './ApiProviders/SpotifyAdAPI';
import GoogleAdManagerAPI from './ApiProviders/GoogleAdManagerAPI';
import SiriusXMAdAPI from './ApiProviders/SiriusXMAdAPI';
import NetworkAdAPI from './ApiProviders/NetworkAdAPI';
import AdCache from './AdCache';
import RevenueCalculator from './RevenueCalculator';

class AdManager {
  constructor() {
    this.apiProviders = new Map();
    this.adCache = new AdCache();
    this.revenueCalculator = new RevenueCalculator();
    this.businessId = null;
    this.isInitialized = false;
    this.adSettings = {
      enabled: true,
      frequency: 5, // every 5 songs
      maxAdsPerHour: 6,
      volumeAdjustment: 0.8
    };
    
    console.log('🎯 AdManager created');
  }

  async initialize(businessId) {
    if (this.isInitialized && this.businessId === businessId) {
      console.log('🎯 AdManager already initialized for business:', businessId);
      return;
    }

    console.log('🎯 Initializing AdManager for business:', businessId);
    this.businessId = businessId;

    try {
      // Initialize API providers
      await this.initializeApiProviders();
      
      // Load business ad settings
      await this.loadBusinessAdSettings();
      
      // Initialize cache and revenue calculator
      await this.adCache.initialize(businessId);
      await this.revenueCalculator.initialize(businessId);
      
      this.isInitialized = true;
      console.log('🎯 AdManager initialized successfully');
      
    } catch (error) {
      console.error('🎯 Error initializing AdManager:', error);
      throw error;
    }
  }

  async initializeApiProviders() {
    try {
      // Get enabled APIs for this business
      const { data: businessApis, error } = await supabase
        .from('music_business_ad_apis')
        .select(`
          *,
          api:music_ad_apis(*)
        `)
        .eq('business_id', this.businessId)
        .eq('enabled', true)
        .order('api.priority', { ascending: true });

      if (error) throw error;

      // Initialize each API provider
      for (const businessApi of businessApis || []) {
        const apiConfig = businessApi.api;
        let provider = null;

        switch (apiConfig.api_name) {
          case 'spotify':
            provider = new SpotifyAdAPI(apiConfig, businessApi);
            break;
          case 'google':
            provider = new GoogleAdManagerAPI(apiConfig, businessApi);
            break;
          case 'siriusxm':
            provider = new SiriusXMAdAPI(apiConfig, businessApi);
            break;
          case 'networks':
            provider = new NetworkAdAPI(apiConfig, businessApi);
            break;
          default:
            console.warn('🎯 Unknown API provider:', apiConfig.api_name);
            continue;
        }

        if (provider) {
          await provider.initialize();
          this.apiProviders.set(apiConfig.api_name, provider);
          console.log(`🎯 Initialized API provider: ${apiConfig.display_name}`);
        }
      }

      console.log(`🎯 Initialized ${this.apiProviders.size} API providers`);
      
    } catch (error) {
      console.error('🎯 Error initializing API providers:', error);
    }
  }

  async loadBusinessAdSettings() {
    try {
      const { data: settings, error } = await supabase
        .from('music_settings')
        .select('ad_frequency, ad_enabled, ad_volume_adjustment, ad_max_per_hour')
        .eq('business_id', this.businessId)
        .limit(1)
        .maybeSingle();

      if (settings) {
        this.adSettings = {
          enabled: settings.ad_enabled !== false,
          frequency: settings.ad_frequency || 5,
          maxAdsPerHour: settings.ad_max_per_hour || 6,
          volumeAdjustment: settings.ad_volume_adjustment || 0.8
        };
      }

      console.log('🎯 Loaded ad settings:', this.adSettings);
      
    } catch (error) {
      console.error('🎯 Error loading ad settings:', error);
    }
  }

  async getNextAd(trackCount = 0) {
    if (!this.isInitialized || !this.adSettings.enabled) {
      console.log('🎯 Ads disabled or manager not initialized');
      return null;
    }

    // Check if it's time for an ad
    if (trackCount % this.adSettings.frequency !== 0) {
      console.log(`🎯 Not time for ad yet (track ${trackCount}, frequency ${this.adSettings.frequency})`);
      return null;
    }

    // Check hourly ad limit
    if (!(await this.checkHourlyLimit())) {
      console.log('🎯 Hourly ad limit reached');
      return null;
    }

    console.log('🎯 Requesting ad from waterfall...');
    
    try {
      // Try each API provider in priority order (waterfall)
      for (const [providerName, provider] of this.apiProviders) {
        console.log(`🎯 Trying ${providerName}...`);
        
        try {
          // Check cache first
          const cachedAd = await this.adCache.getAd(providerName);
          if (cachedAd) {
            console.log(`🎯 Using cached ad from ${providerName}`);
            await this.logAdRequest(providerName, true, 0, 'cache_hit');
            return this.processAdForPlayback(cachedAd, providerName);
          }

          // Request new ad from API
          const startTime = Date.now();
          const ad = await provider.requestAd({
            businessType: 'restaurant', // TODO: Get from business profile
            location: 'Ontario, Canada',
            timeOfDay: new Date().getHours()
          });

          const responseTime = Date.now() - startTime;

          if (ad) {
            console.log(`🎯 Got ad from ${providerName} in ${responseTime}ms`);
            
            // Cache the ad
            await this.adCache.cacheAd(providerName, ad);
            
            // Log successful request
            await this.logAdRequest(providerName, true, responseTime, 'api_success');
            
            return this.processAdForPlayback(ad, providerName);
          }

        } catch (error) {
          console.error(`🎯 Error from ${providerName}:`, error);
          await this.logAdRequest(providerName, false, 0, error.message);
          // Continue to next provider
        }
      }

      console.log('🎯 No ads available from any provider');
      return null;
      
    } catch (error) {
      console.error('🎯 Error in getNextAd:', error);
      return null;
    }
  }

  async processAdForPlayback(ad, providerName) {
    try {
      // Create ad play record
      const { data: adPlay, error } = await supabase
        .from('music_ad_plays')
        .insert({
          ad_id: ad.id || null,
          business_id: this.businessId,
          played_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      // Calculate and log revenue
      await this.revenueCalculator.calculateAdRevenue(adPlay.id, ad, providerName);

      return {
        id: ad.id,
        audioUrl: ad.audioUrl,
        duration: ad.duration,
        title: ad.title,
        advertiser: ad.advertiser,
        providerName: providerName,
        adPlayId: adPlay.id,
        volumeAdjustment: this.adSettings.volumeAdjustment
      };

    } catch (error) {
      console.error('🎯 Error processing ad for playback:', error);
      return null;
    }
  }

  async checkHourlyLimit() {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      
      const { count, error } = await supabase
        .from('music_ad_plays')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', this.businessId)
        .gte('played_at', oneHourAgo);

      if (error) throw error;

      return (count || 0) < this.adSettings.maxAdsPerHour;
      
    } catch (error) {
      console.error('🎯 Error checking hourly limit:', error);
      return true; // Allow ads if we can't check
    }
  }

  async logAdRequest(providerName, success, responseTime, details) {
    try {
      // Update performance tracking
      const today = new Date().toISOString().split('T')[0];
      
      const { error } = await supabase
        .from('music_api_performance')
        .upsert({
          business_id: this.businessId,
          api_provider: providerName,
          date_recorded: today,
          total_requests: 1,
          successful_requests: success ? 1 : 0,
          failed_requests: success ? 0 : 1,
          average_response_time_ms: responseTime,
          total_ads_served: success ? 1 : 0
        }, {
          onConflict: 'business_id,api_provider,date_recorded',
          ignoreDuplicates: false
        });

      if (error) {
        // If upsert failed, try increment existing record
        await this.incrementPerformanceCounters(providerName, success, responseTime);
      }

    } catch (error) {
      console.error('🎯 Error logging ad request:', error);
    }
  }

  async incrementPerformanceCounters(providerName, success, responseTime) {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Get existing record
      const { data: existing } = await supabase
        .from('music_api_performance')
        .select('*')
        .eq('business_id', this.businessId)
        .eq('api_provider', providerName)
        .eq('date_recorded', today)
        .single();

      if (existing) {
        // Update existing record
        const totalRequests = existing.total_requests + 1;
        const successfulRequests = existing.successful_requests + (success ? 1 : 0);
        const failedRequests = existing.failed_requests + (success ? 0 : 1);
        const totalAdsServed = existing.total_ads_served + (success ? 1 : 0);
        
        // Calculate new average response time
        const avgResponseTime = Math.round(
          (existing.average_response_time_ms * existing.total_requests + responseTime) / totalRequests
        );

        await supabase
          .from('music_api_performance')
          .update({
            total_requests: totalRequests,
            successful_requests: successfulRequests,
            failed_requests: failedRequests,
            average_response_time_ms: avgResponseTime,
            total_ads_served: totalAdsServed,
            fill_rate: totalRequests > 0 ? Math.round((successfulRequests / totalRequests) * 100) : 0
          })
          .eq('id', existing.id);
      }
      
    } catch (error) {
      console.error('🎯 Error incrementing performance counters:', error);
    }
  }

  // Update ad settings
  async updateAdSettings(newSettings) {
    try {
      const { error } = await supabase
        .from('music_settings')
        .upsert({
          business_id: this.businessId,
          ad_frequency: newSettings.frequency,
          ad_enabled: newSettings.enabled,
          ad_volume_adjustment: newSettings.volumeAdjustment,
          ad_max_per_hour: newSettings.maxAdsPerHour,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'business_id'
        });

      if (error) throw error;

      this.adSettings = { ...this.adSettings, ...newSettings };
      console.log('🎯 Updated ad settings:', this.adSettings);
      
    } catch (error) {
      console.error('🎯 Error updating ad settings:', error);
      throw error;
    }
  }

  // Get current revenue stats
  async getRevenueStats(timeframe = '30days') {
    try {
      let startDate;
      switch (timeframe) {
        case 'today':
          startDate = new Date().toISOString().split('T')[0];
          break;
        case '7days':
          startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          break;
        case '30days':
        default:
          startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      }

      const { data, error } = await supabase
        .from('music_ad_revenue_detailed')
        .select('*')
        .eq('business_id', this.businessId)
        .gte('created_at', startDate);

      if (error) throw error;

      const stats = {
        totalRevenue: 0,
        totalPlays: data?.length || 0,
        revenueByProvider: {},
        averageCPM: 0
      };

      data?.forEach(record => {
        stats.totalRevenue += parseFloat(record.business_payout || 0);
        
        if (!stats.revenueByProvider[record.api_provider]) {
          stats.revenueByProvider[record.api_provider] = 0;
        }
        stats.revenueByProvider[record.api_provider] += parseFloat(record.business_payout || 0);
      });

      stats.averageCPM = stats.totalPlays > 0 ? (stats.totalRevenue / stats.totalPlays) * 1000 : 0;

      return stats;
      
    } catch (error) {
      console.error('🎯 Error getting revenue stats:', error);
      return { totalRevenue: 0, totalPlays: 0, revenueByProvider: {}, averageCPM: 0 };
    }
  }

  // Health check
  async healthCheck() {
    const health = {
      initialized: this.isInitialized,
      businessId: this.businessId,
      providersCount: this.apiProviders.size,
      providers: {},
      settings: this.adSettings
    };

    for (const [name, provider] of this.apiProviders) {
      try {
        health.providers[name] = await provider.healthCheck();
      } catch (error) {
        health.providers[name] = { status: 'error', error: error.message };
      }
    }

    return health;
  }

  // Cleanup
  destroy() {
    this.apiProviders.clear();
    this.adCache = null;
    this.revenueCalculator = null;
    this.isInitialized = false;
    console.log('🎯 AdManager destroyed');
  }
}

// Create singleton instance
export const globalAdManager = new AdManager();

// Auto-initialize when business context is available
if (typeof window !== 'undefined') {
  window.globalAdManager = globalAdManager;
}

export default AdManager;