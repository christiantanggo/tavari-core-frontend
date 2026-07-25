// services/music-v2/AdService.js
// Ad selection and playback service

import { supabase } from '../../supabaseClient';

class AdService {
  constructor() {
    this.adsCache = new Map();
    this.lastFetchTime = null;
    this.cacheExpiry = 3600000; // 1 hour
  }

  /**
   * Get available ads for a location
   * @param {string} locationId - Location ID
   * @param {object} options - Selection options
   * @returns {Promise<object|null>} Selected ad or null
   */
  async getAdForLocation(locationId, options = {}) {
    try {
      // Check cache first
      const cacheKey = `${locationId}_${JSON.stringify(options)}`;
      const cached = this.adsCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.cacheExpiry) {
        return cached.ad;
      }

      // Fetch active ad campaigns for this location
      const { data: campaigns, error } = await supabase
        .from('music_v2_ad_campaigns')
        .select(`
          *,
          ads:music_v2_ads(*)
        `)
        .eq('location_id', locationId)
        .eq('is_active', true)
        .gte('end_date', new Date().toISOString())
        .order('priority', { ascending: false });

      if (error) {
        console.error('Error fetching ad campaigns:', error);
        return null;
      }

      if (!campaigns || campaigns.length === 0) {
        return null;
      }

      // Select best ad based on priority and targeting
      const selectedAd = this.selectBestAd(campaigns, options);

      // Cache result
      if (selectedAd) {
        this.adsCache.set(cacheKey, {
          ad: selectedAd,
          timestamp: Date.now()
        });
      }

      return selectedAd;
    } catch (error) {
      console.error('Error in getAdForLocation:', error);
      return null;
    }
  }

  /**
   * Select best ad from campaigns
   * @param {Array} campaigns - Active campaigns
   * @param {object} options - Selection options
   * @returns {object|null} Selected ad
   */
  selectBestAd(campaigns, options) {
    // Filter campaigns by targeting criteria
    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDay();

    const eligibleCampaigns = campaigns.filter(campaign => {
      // Check time targeting
      if (campaign.targeting_time_start !== null && 
          currentHour < campaign.targeting_time_start) {
        return false;
      }
      if (campaign.targeting_time_end !== null && 
          currentHour >= campaign.targeting_time_end) {
        return false;
      }

      // Check day targeting
      if (campaign.targeting_days && campaign.targeting_days.length > 0) {
        if (!campaign.targeting_days.includes(currentDay)) {
          return false;
        }
      }

      // Check if campaign has ads
      if (!campaign.ads || campaign.ads.length === 0) {
        return false;
      }

      return true;
    });

    if (eligibleCampaigns.length === 0) {
      return null;
    }

    // Sort by priority (highest first)
    eligibleCampaigns.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    // Select highest priority campaign
    const selectedCampaign = eligibleCampaigns[0];

    // Select random ad from campaign (for rotation)
    const ads = selectedCampaign.ads.filter(ad => ad.is_active);
    if (ads.length === 0) {
      return null;
    }

    const randomAd = ads[Math.floor(Math.random() * ads.length)];

    return {
      id: randomAd.id,
      campaign_id: selectedCampaign.id,
      title: randomAd.title || 'Advertisement',
      file_path: randomAd.file_path,
      duration: randomAd.duration || 30,
      click_url: randomAd.click_url,
      impression_url: randomAd.impression_url,
      source: 'music_v2_ads'
    };
  }

  /**
   * Log ad impression
   * @param {string} adId - Ad ID
   * @param {string} deviceId - Device ID
   * @param {string} locationId - Location ID
   */
  async logImpression(adId, deviceId, locationId) {
    try {
      // Log to playback logs
      await supabase
        .from('music_v2_playback_logs')
        .insert({
          device_id: deviceId,
          location_id: locationId,
          log_type: 'ad',
          ad_id: adId,
          start_time: new Date().toISOString(),
          synced_to_server: true
        });

      // Update ad impression count
      await supabase.rpc('increment_ad_impressions', { ad_id: adId });

      // Call impression URL if provided
      // (This would be done via a server-side webhook in production)
    } catch (error) {
      console.error('Error logging ad impression:', error);
    }
  }

  /**
   * Log ad click
   * @param {string} adId - Ad ID
   * @param {string} deviceId - Device ID
   * @param {string} locationId - Location ID
   */
  async logClick(adId, deviceId, locationId) {
    try {
      // Update ad click count
      await supabase.rpc('increment_ad_clicks', { ad_id: adId });

      // Call click URL if provided
      // (This would be done via a server-side webhook in production)
    } catch (error) {
      console.error('Error logging ad click:', error);
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.adsCache.clear();
    this.lastFetchTime = null;
  }
}

export const adService = new AdService();
export default adService;


